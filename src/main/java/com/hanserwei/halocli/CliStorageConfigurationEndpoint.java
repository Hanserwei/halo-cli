package com.hanserwei.halocli;

import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerRequest;
import org.springframework.web.reactive.function.server.ServerResponse;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.Role;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.core.user.service.RoleService;
import run.halo.app.extension.GroupVersion;

/** The native policy configuration permission is required in addition to this route's Halo RBAC. */
@Component
public class CliStorageConfigurationEndpoint implements CustomEndpoint {
    private static final String ROUTE = "/policies/{name}/configs/default";
    private static final Set<String> FIELDS = Set.of("policyVersion", "configMapName",
        "configMapVersion", "config");
    private static final ObjectMapper JSON = new ObjectMapper()
        .enable(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    private final CliStorageConfigurationService configurations;
    private final RoleService roles;

    public CliStorageConfigurationEndpoint(CliStorageConfigurationService configurations,
        RoleService roles) {
        this.configurations = configurations;
        this.roles = roles;
    }

    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .GET(ROUTE, request -> authorize(request, "get", "policies:read")
                .then(Mono.defer(() -> configurations.get(request.pathVariable("name"))))
                // Keep JsonNode serialization with its own Jackson version, independent of Halo's codecs.
                .flatMap(snapshot -> Mono.fromCallable(() -> JSON.writeValueAsBytes(snapshot)))
                .flatMap(body -> ServerResponse.ok().contentType(MediaType.APPLICATION_JSON)
                    .cacheControl(CacheControl.noStore()).bodyValue(body)))
            .PUT(ROUTE, request -> authorize(request, "update", "policies:write")
                .then(Mono.defer(() -> input(request)))
                .flatMap(snapshot -> configurations.put(request.pathVariable("name"), snapshot))
                .then(ServerResponse.noContent().cacheControl(CacheControl.noStore()).build()))
            .filter((request, next) -> Mono.defer(() -> next.handle(request))
                // Neither parser errors nor extension errors may echo stored/submitted secrets.
                .onErrorResume(error -> ServerResponse.status(error instanceof ResponseStatusException status
                        ? status.getStatusCode().value() : HttpStatus.INTERNAL_SERVER_ERROR.value())
                    .cacheControl(CacheControl.noStore()).build()))
            .build();
    }

    private Mono<Void> authorize(ServerRequest request, String verb, String scope) {
        return request.principal().ofType(Authentication.class)
            .filter(auth -> auth.isAuthenticated()
                && !(auth instanceof AnonymousAuthenticationToken)
                && auth.getName() != null && !auth.getName().isBlank())
            .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.UNAUTHORIZED)))
            .flatMap(auth -> {
                if (auth instanceof CliKeyAuthenticationToken key && !key.scopes().contains(scope)) {
                    return Mono.error(new ResponseStatusException(HttpStatus.FORBIDDEN));
                }
                // Use the authenticated roles, not all username roles: PAT authorities can be
                // narrower than the owner's roles. Resolve their current rules on each request.
                var roleNames = auth.getAuthorities().stream()
                    .map(authority -> authority.getAuthority())
                    .filter(authority -> authority.startsWith("ROLE_"))
                    .map(authority -> authority.substring(5)).collect(Collectors.toSet());
                return roles.listDependenciesFlux(roleNames)
                    .filter(role -> role.getRules() != null)
                    .flatMapIterable(Role::getRules)
                    .any(rule -> permits(rule, verb, request.pathVariable("name")))
                    .flatMap(allowed -> allowed ? Mono.empty()
                        : Mono.error(new ResponseStatusException(HttpStatus.FORBIDDEN)));
            });
    }

    private static boolean permits(Role.PolicyRule rule, String verb, String name) {
        return matches(rule.getVerbs(), verb)
            && matches(rule.getApiGroups(), "console.api.storage.halo.run")
            // Use a conservative subset of Halo 2.27's resource matcher. In particular,
            // accepting a parent "policies" rule must never grant the configs subresource.
            && matches(rule.getResources(), "policies/configs")
            && resourceNameMatches(rule.getResourceNames(), name);
    }

    private static boolean matches(String[] values, String expected) {
        return Arrays.stream(values).anyMatch(value -> "*".equals(value) || expected.equals(value));
    }

    private static boolean resourceNameMatches(String[] patterns, String name) {
        if (patterns.length == 0) {
            return true;
        }
        // Halo 2.27's RbacRequestEvaluation returns on the first name pattern. Keep that
        // restriction here, including segment prefix/suffix wildcards, to avoid broadening it.
        var parts = Arrays.stream(patterns[0].split("/"))
            .filter(part -> !part.isEmpty()).toArray(String[]::new);
        var requested = new String[]{name, "default"};
        for (int i = 0; i < parts.length; i++) {
            var pattern = parts[i];
            var text = i < requested.length ? requested[i] : "";
            boolean match = pattern.equals("*")
                || (pattern.startsWith("*") ? text.endsWith(pattern.substring(1))
                    : pattern.endsWith("*") ? text.startsWith(pattern.substring(0, pattern.length() - 1))
                    : pattern.equals(text));
            if (!match) {
                return false;
            }
        }
        return true;
    }

    private Mono<CliStorageConfigurationService.Snapshot> input(ServerRequest request) {
        return request.bodyToMono(byte[].class)
            .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST)))
            .map(bytes -> {
                try {
                    JsonNode body = JSON.readTree(bytes);
                    if (body == null || !body.isObject() || body.size() != FIELDS.size()
                        || !FIELDS.stream().allMatch(body::has)
                        || !version(body.get("policyVersion"))
                        || !(body.get("configMapName").isNull()
                            || body.get("configMapName").isTextual())
                        || !(body.get("configMapVersion").isNull()
                            || version(body.get("configMapVersion")))
                        || !body.get("config").isObject()) {
                        throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
                    }
                    return new CliStorageConfigurationService.Snapshot(
                        body.get("policyVersion").longValue(),
                        body.get("configMapName").isNull() ? null
                            : body.get("configMapName").textValue(),
                        body.get("configMapVersion").isNull() ? null
                            : body.get("configMapVersion").longValue(),
                        body.get("config"));
                } catch (IOException | IllegalArgumentException error) {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST);
                }
            });
    }

    private static boolean version(JsonNode value) {
        return value.isIntegralNumber() && value.canConvertToLong();
    }

    @Override
    public GroupVersion groupVersion() {
        return new GroupVersion("console.api.halo-cli.halo.run", "v1alpha1");
    }
}
