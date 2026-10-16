package com.hanserwei.halocli;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.ObjectReader;
import java.io.IOException;
import java.util.Set;
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
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.GroupVersion;

/** Owner-scoped UI operations. Halo RBAC remains responsible for granting each operation. */
@Component
public class CliKeyEndpoint implements CustomEndpoint {
    private final CliAccessKeyService keys;
    private final CliScopePolicy scopePolicy;
    private final ObjectReader inputReader;

    public CliKeyEndpoint(CliAccessKeyService keys, CliScopePolicy scopePolicy) {
        this.keys = keys;
        this.scopePolicy = scopePolicy;
        // Do not inherit Halo's tolerance for unknown JSON fields on this security-sensitive API.
        this.inputReader = new ObjectMapper().findAndRegisterModules()
            .readerFor(CliAccessKeyService.KeyInput.class)
            .with(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES)
            .with(DeserializationFeature.FAIL_ON_TRAILING_TOKENS);
    }

    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .GET("/keys", this::list)
            .GET("/scopes", this::scopes)
            .POST("/keys", this::create)
            .PUT("/keys/{name}", this::update)
            .POST("/keys/{name}/rotate", this::rotate)
            .DELETE("/keys/{name}", this::delete)
            .GET("/auth/me", this::me)
            .filter((request, next) -> Mono.defer(() -> next.handle(request))
                .onErrorMap(IllegalArgumentException.class,
                    error -> badRequest(error.getMessage(), error)))
            .build();
    }

    private Mono<ServerResponse> list(ServerRequest request) {
        return managementAuthentication(request)
            .flatMap(auth -> keys.list(auth.getName()).collectList())
            .flatMap(items -> json(HttpStatus.OK).bodyValue(items));
    }

    private Mono<ServerResponse> scopes(ServerRequest request) {
        return managementAuthentication(request)
            .flatMap(auth -> json(HttpStatus.OK).bodyValue(scopePolicy.scopes()));
    }

    private Mono<ServerResponse> create(ServerRequest request) {
        return managementAuthentication(request)
            .flatMap(auth -> input(request)
                .flatMap(body -> keys.create(auth.getName(), body)))
            .flatMap(created -> json(HttpStatus.CREATED).bodyValue(created));
    }

    private Mono<ServerResponse> update(ServerRequest request) {
        return managementAuthentication(request)
            .flatMap(auth -> input(request)
                .flatMap(body -> keys.update(auth.getName(), request.pathVariable("name"), body)))
            .flatMap(key -> json(HttpStatus.OK).bodyValue(key));
    }

    private Mono<ServerResponse> rotate(ServerRequest request) {
        return managementAuthentication(request)
            .flatMap(auth -> keys.rotate(auth.getName(), request.pathVariable("name")))
            .flatMap(created -> json(HttpStatus.OK).bodyValue(created));
    }

    private Mono<ServerResponse> delete(ServerRequest request) {
        return managementAuthentication(request)
            .flatMap(auth -> keys.delete(auth.getName(), request.pathVariable("name")))
            .then(ServerResponse.noContent().cacheControl(CacheControl.noStore()).build());
    }

    private Mono<ServerResponse> me(ServerRequest request) {
        return authentication(request).flatMap(auth -> {
            var identity = auth instanceof CliKeyAuthenticationToken key
                ? new Identity(auth.getName(), key.keyName(), key.keyDisplayName(), key.scopes())
                : new Identity(auth.getName(), null, null, Set.of());
            return json(HttpStatus.OK).bodyValue(identity);
        });
    }

    private Mono<Authentication> managementAuthentication(ServerRequest request) {
        return authentication(request).flatMap(auth -> auth instanceof CliKeyAuthenticationToken
            ? Mono.error(new ResponseStatusException(HttpStatus.FORBIDDEN,
                "CLI keys cannot manage access keys"))
            : Mono.just(auth));
    }

    private Mono<Authentication> authentication(ServerRequest request) {
        return request.principal().ofType(Authentication.class)
            .filter(auth -> auth.isAuthenticated()
                && !(auth instanceof AnonymousAuthenticationToken)
                && auth.getName() != null && !auth.getName().isBlank())
            .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.UNAUTHORIZED,
                "Authentication required")));
    }

    private Mono<CliAccessKeyService.KeyInput> input(ServerRequest request) {
        return request.bodyToMono(byte[].class)
            .switchIfEmpty(Mono.error(badRequest("JSON body is required", null)))
            .map(bytes -> {
                try {
                    CliAccessKeyService.KeyInput input = inputReader.readValue(bytes);
                    if (input == null) {
                        throw badRequest("JSON body must be an object", null);
                    }
                    return input;
                } catch (IOException error) {
                    throw badRequest("Invalid key JSON body", error);
                }
            });
    }

    private static ServerResponse.BodyBuilder json(HttpStatus status) {
        return ServerResponse.status(status)
            .contentType(MediaType.APPLICATION_JSON)
            .cacheControl(CacheControl.noStore());
    }

    private static ResponseStatusException badRequest(String message, Throwable cause) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message, cause);
    }

    @Override
    public GroupVersion groupVersion() {
        return new GroupVersion("console.api.halo-cli.halo.run", "v1alpha1");
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Identity(String username, String keyName, String keyDisplayName,
        Set<String> scopes) {
    }
}
