package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import java.security.Principal;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.server.resource.authentication.JwtAuthenticationToken;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.Role;
import run.halo.app.core.user.service.RoleService;
import run.halo.app.extension.GroupVersion;
import run.halo.app.extension.Metadata;

class CliStorageConfigurationEndpointTest {
    private static final String POLICY = "policy-one";
    private static final String CONFIG_MAP = "policy-config";
    private static final String PATH = "/policies/" + POLICY + "/configs/default";
    private static final String NATIVE_GROUP = "console.api.storage.halo.run";
    private static final String SECRET = "storage-credential-must-not-appear-in-errors";
    private static final Set<String> ROLE_NAMES = Set.of("STORAGE_OPERATOR");
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Route GET = new Route(HttpMethod.GET, "get", "policies:read");
    private static final Route PUT = new Route(HttpMethod.PUT, "update", "policies:write");
    private static final String BODY = """
        {"policyVersion":7,"configMapName":"policy-config","configMapVersion":11,
         "config":{"accessKey":"%s","region":"test"}}
        """.formatted(SECRET);
    private final CliStorageConfigurationService configurations =
        mock(CliStorageConfigurationService.class);
    private final RoleService roles = mock(RoleService.class);
    private final CliStorageConfigurationEndpoint endpoint =
        new CliStorageConfigurationEndpoint(configurations, roles);

    @Test
    void shouldUsePluginApiGroup() {
        assertThat(endpoint.groupVersion())
            .isEqualTo(new GroupVersion("console.api.halo-cli.halo.run", "v1alpha1"));
    }

    @ParameterizedTest
    @MethodSource("principals")
    void shouldGetExactlyTheFourSnapshotFieldsWithNativePermission(Authentication principal) {
        permissions(nativeRule("get"));
        when(configurations.get(POLICY)).thenReturn(Mono.just(snapshot()));

        client(principal).get().uri(PATH
                + "?name=other-policy&group=private&configMapName=unrelated&ownerName=mallory")
            .exchange().expectStatus().isOk()
            .expectHeader().contentType(MediaType.APPLICATION_JSON)
            .expectHeader().valueEquals("Cache-Control", "no-store")
            .expectBody().json(BODY, true);

        verify(configurations).get(POLICY);
        verifyNoMoreInteractions(configurations);
        verify(roles).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @Test
    void shouldIncludeExplicitNullReferenceFieldsForAnUnconfiguredPolicy() {
        permissions(nativeRule("get"));
        when(configurations.get(POLICY)).thenReturn(Mono.just(
            new CliStorageConfigurationService.Snapshot(7L, null, null, JSON.createObjectNode())));

        client(session()).get().uri(PATH).exchange().expectStatus().isOk()
            .expectHeader().valueEquals("Cache-Control", "no-store")
            .expectBody().json("""
                {"policyVersion":7,"configMapName":null,"configMapVersion":null,"config":{}}
                """, true)
            .jsonPath("$.configMapName").hasJsonPath()
            .jsonPath("$.configMapVersion").hasJsonPath();

        verify(configurations).get(POLICY);
    }

    @ParameterizedTest
    @MethodSource("principals")
    void shouldPutTheExactSnapshotAndReturnNoContent(Authentication principal) {
        permissions(nativeRule("update"));
        when(configurations.put(eq(POLICY), any())).thenReturn(Mono.empty());

        client(principal).put().uri(PATH
                + "?name=other-policy&group=private&configMapName=unrelated&ownerName=mallory")
            .contentType(MediaType.APPLICATION_JSON).bodyValue(BODY)
            .exchange().expectStatus().isNoContent()
            .expectHeader().valueEquals("Cache-Control", "no-store")
            .expectBody().isEmpty();

        verify(configurations).put(POLICY, snapshot());
        verifyNoMoreInteractions(configurations);
        verify(roles).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @Test
    void shouldAcceptExplicitNullReferencesWithoutChoosingAConfigMap() {
        permissions(nativeRule("update"));
        when(configurations.put(eq(POLICY), any())).thenReturn(Mono.empty());

        client(session()).put().uri(PATH).contentType(MediaType.APPLICATION_JSON)
            .bodyValue("""
                {"policyVersion":7,"configMapName":null,"configMapVersion":null,"config":{}}
                """)
            .exchange().expectStatus().isNoContent()
            .expectHeader().valueEquals("Cache-Control", "no-store")
            .expectBody().isEmpty();

        verify(configurations).put(POLICY,
            new CliStorageConfigurationService.Snapshot(7L, null, null, JSON.createObjectNode()));
    }

    @Test
    void shouldPreserveLongVersionsAndNestedConfiguration() throws Exception {
        permissions(nativeRule("update"));
        when(configurations.put(eq(POLICY), any())).thenReturn(Mono.empty());
        var config = JSON.readTree("""
            {"credentials":{"secret":"%s"},"enabled":true,"ports":[443],"optional":null}
            """.formatted(SECRET));
        var body = JSON.createObjectNode().put("policyVersion", Long.MAX_VALUE)
            .put("configMapName", CONFIG_MAP).put("configMapVersion", Long.MAX_VALUE);
        body.set("config", config);

        client(session()).put().uri(PATH).contentType(MediaType.APPLICATION_JSON)
            .bodyValue(body.toString()).exchange().expectStatus().isNoContent()
            .expectBody().isEmpty();

        verify(configurations).put(POLICY, new CliStorageConfigurationService.Snapshot(
            Long.MAX_VALUE, CONFIG_MAP, Long.MAX_VALUE, config));
    }

    @Test
    void shouldResolveOnlyTheCurrentPatRoleAuthoritiesInsteadOfTheOwnersRoles() {
        var principal = pat("ROLE_PAT_READER", "SCOPE_storage", "STORAGE_OPERATOR");
        var role = role(nativeRule("get"));
        when(roles.listDependenciesFlux(Set.of("PAT_READER"))).thenReturn(Flux.just(role));
        when(configurations.get(POLICY)).thenReturn(Mono.just(snapshot()));

        exchange(principal, GET).expectStatus().isOk();
        exchange(principal, PUT).expectStatus().isForbidden()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verify(roles, times(2)).listDependenciesFlux(Set.of("PAT_READER"));
        verifyNoMoreInteractions(roles);
        verify(configurations).get(POLICY);
        verifyNoMoreInteractions(configurations);
    }

    @Test
    void shouldCollectOnlyDistinctRoleNamesFromTheSessionAuthorities() {
        var principal = UsernamePasswordAuthenticationToken.authenticated("alice", "session-secret",
            List.of(new SimpleGrantedAuthority("ROLE_STORAGE_OPERATOR"),
                new SimpleGrantedAuthority("ROLE_AUDITOR"),
                new SimpleGrantedAuthority("ROLE_STORAGE_OPERATOR"),
                new SimpleGrantedAuthority("SCOPE_policies:read"),
                new SimpleGrantedAuthority("policies/configs")));
        when(roles.listDependenciesFlux(Set.of("STORAGE_OPERATOR", "AUDITOR")))
            .thenReturn(Flux.just(role(nativeRule("get"))));
        when(configurations.get(POLICY)).thenReturn(Mono.just(snapshot()));

        exchange(principal, GET).expectStatus().isOk();

        verify(roles).listDependenciesFlux(Set.of("STORAGE_OPERATOR", "AUDITOR"));
        verifyNoMoreInteractions(roles);
        verify(configurations).get(POLICY);
    }

    @ParameterizedTest
    @MethodSource("nonNativeRules")
    void shouldRejectRouteConfigMapParentOrOtherGroupPermissions(Role.PolicyRule rule) {
        permissions(rule);

        for (var principal : principals().toList()) {
            for (var route : routes().toList()) {
                exchange(principal, route).expectStatus().isForbidden()
                    .expectHeader().valueEquals("Cache-Control", "no-store")
                    .expectBody().isEmpty();
            }
        }

        verifyNoInteractions(configurations);
        verify(roles, times(6)).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @ParameterizedTest
    @MethodSource("routes")
    void shouldRejectMissingRolesAndRolesWithoutRules(Route route) {
        when(roles.listDependenciesFlux(ROLE_NAMES))
            .thenReturn(Flux.empty(), Flux.just(new Role(), role()));
        var principal = key("policies:read", "policies:write");

        exchange(principal, route).expectStatus().isForbidden()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();
        exchange(principal, route).expectStatus().isForbidden()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verifyNoInteractions(configurations);
        verify(roles, times(2)).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @ParameterizedTest
    @MethodSource("routes")
    void shouldResolveHiddenRoleDependenciesForNativeAuthorization(Route route) {
        var dependency = role(nativeRule(route.verb()));
        var metadata = new Metadata();
        metadata.setName("hidden-storage-dependency");
        metadata.setLabels(java.util.Map.of(Role.HIDDEN_LABEL_NAME, "true"));
        dependency.setMetadata(metadata);
        when(roles.listDependenciesFlux(ROLE_NAMES)).thenReturn(Flux.just(dependency));
        stubConfiguration();

        exchange(session(), route).expectStatus().isEqualTo(successStatus(route));

        verify(roles).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
        verifyConfiguration(route, 1);
    }

    @ParameterizedTest
    @MethodSource("nativeWildcardRules")
    void shouldHonorNativeApiGroupResourceAndVerbWildcards(Role.PolicyRule rule) {
        permissions(rule);
        stubConfiguration();

        for (var principal : principals().toList()) {
            for (var route : routes().toList()) {
                exchange(principal, route).expectStatus().isEqualTo(successStatus(route));
            }
        }

        verifyConfiguration(GET, 3);
        verifyConfiguration(PUT, 3);
        verify(roles, times(6)).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @ParameterizedTest
    @MethodSource("resourceNames")
    void shouldApplyNativePolicyAndDefaultGroupNameRestrictions(List<String> names,
        boolean allowed) {
        permissions(new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP)
            .resources("policies/configs").resourceNames(names.toArray(String[]::new))
            .verbs("get", "update").build());
        if (allowed) {
            stubConfiguration();
        }

        for (var principal : principals().toList()) {
            for (var route : routes().toList()) {
                exchange(principal, route).expectStatus()
                    .isEqualTo(allowed ? successStatus(route) : HttpStatus.FORBIDDEN);
            }
        }

        if (allowed) {
            verifyConfiguration(GET, 3);
            verifyConfiguration(PUT, 3);
        } else {
            verifyNoInteractions(configurations);
        }
        verify(roles, times(6)).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @ParameterizedTest
    @MethodSource("routes")
    void shouldKeepGetAndUpdatePermissionsIndependent(Route allowed) {
        permissions(nativeRule(allowed.verb()));
        stubConfiguration();
        var denied = allowed.equals(GET) ? PUT : GET;

        for (var principal : principals().toList()) {
            exchange(principal, allowed).expectStatus().isEqualTo(successStatus(allowed));
            exchange(principal, denied).expectStatus().isForbidden()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();
        }

        verifyConfiguration(allowed, 3);
        verifyNoMoreInteractions(configurations);
        verify(roles, times(6)).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @ParameterizedTest
    @MethodSource("routes")
    void shouldRequireTheMatchingKeyScopeEvenWhenTheOwnerHasBothPermissions(Route allowed) {
        permissions(nativeRule("get", "update"));
        stubConfiguration();
        var principal = key(allowed.scope());
        var denied = allowed.equals(GET) ? PUT : GET;

        exchange(principal, allowed).expectStatus().isEqualTo(successStatus(allowed));
        exchange(principal, denied).expectStatus().isForbidden()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verifyConfiguration(allowed, 1);
        verifyNoMoreInteractions(configurations);
        verify(roles).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @ParameterizedTest
    @MethodSource("insufficientScopes")
    void shouldRejectMissingUnrelatedOrWildcardKeyScopesBeforeResolvingRoles(Set<String> scopes) {
        var principal = key(scopes.toArray(String[]::new));

        for (var route : routes().toList()) {
            exchange(principal, route).expectStatus().isForbidden()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();
        }

        verifyNoInteractions(configurations, roles);
    }

    @ParameterizedTest
    @MethodSource("routes")
    void shouldRequireCurrentOwnerPermissionsAsWellAsTheKeyScopeOnEveryRequest(Route route) {
        when(roles.listDependenciesFlux(ROLE_NAMES))
            .thenReturn(Flux.just(role(nativeRule(route.verb()))), Flux.empty());
        stubConfiguration();
        var principal = key(route.scope());
        var client = client(principal);

        exchange(client, route).expectStatus().isEqualTo(successStatus(route));
        exchange(client, route).expectStatus().isForbidden()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verifyConfiguration(route, 1);
        verifyNoMoreInteractions(configurations);
        verify(roles, times(2)).listDependenciesFlux(ROLE_NAMES);
        verifyNoMoreInteractions(roles);
    }

    @ParameterizedTest
    @MethodSource("routes")
    void shouldRejectAnonymousUnauthenticatedOrInvalidPrincipals(Route route) {
        var anonymous = new AnonymousAuthenticationToken("anonymous", "anonymousUser",
            List.of(new SimpleGrantedAuthority("ROLE_STORAGE_OPERATOR")));
        var nameless = mock(Authentication.class);
        when(nameless.isAuthenticated()).thenReturn(true);
        Principal[] rejected = {null, anonymous,
            UsernamePasswordAuthenticationToken.unauthenticated("alice", "password"),
            UsernamePasswordAuthenticationToken.authenticated(" ", "session-secret", List.of()),
            nameless, (Principal) () -> "alice"};

        for (var principal : rejected) {
            exchange(principal, route).expectStatus().isUnauthorized()
                .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();
        }

        verifyNoInteractions(configurations, roles);
    }

    @ParameterizedTest
    @MethodSource("unsupportedPaths")
    void shouldNotExposeOtherGroupsOrConfigMapPaths(String path) {
        for (var route : routes().toList()) {
            client(session()).method(route.method()).uri(path)
                .contentType(MediaType.APPLICATION_JSON).bodyValue(BODY)
                .exchange().expectStatus().isNotFound();
        }

        verifyNoInteractions(configurations, roles);
    }

    @ParameterizedTest
    @MethodSource("invalidBodies")
    void shouldRejectInvalidJsonMissingFieldsAndWrongDtoTypesWithoutEchoingSecrets(String body) {
        permissions(nativeRule("update"));

        client(session()).put().uri(PATH).contentType(MediaType.APPLICATION_JSON).bodyValue(body)
            .exchange().expectStatus().isBadRequest()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verifyNoInteractions(configurations);
        verify(roles).listDependenciesFlux(ROLE_NAMES);
    }

    @ParameterizedTest
    @ValueSource(strings = {"name", "policyName", "group", "configGroup", "ownerName", "owner",
        "configMap", "configMapRef", "settingName", "settingRef", "data", "metadata", "spec",
        "unexpected"})
    void shouldRejectEveryAdditionalTopLevelAssociationField(String field) throws Exception {
        permissions(nativeRule("update"));
        var body = ((ObjectNode) JSON.readTree(BODY)).put(field, SECRET);

        client(session()).put().uri(PATH).contentType(MediaType.APPLICATION_JSON)
            .bodyValue(body.toString()).exchange().expectStatus().isBadRequest()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verifyNoInteractions(configurations);
    }

    @Test
    void shouldRejectAMissingBody() {
        permissions(nativeRule("update"));

        client(session()).put().uri(PATH).exchange().expectStatus().isBadRequest()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verifyNoInteractions(configurations);
    }

    @ParameterizedTest
    @MethodSource("principals")
    void shouldCheckNativePermissionBeforeParsingASecretBearingBody(Authentication principal) {
        permissions(new Role.PolicyRule.Builder().apiGroups("console.api.halo-cli.halo.run")
            .resources("policies/configs").verbs("update").build());

        client(principal).put().uri(PATH).contentType(MediaType.APPLICATION_JSON)
            .bodyValue("{\"config\":\"" + SECRET)
            .exchange().expectStatus().isForbidden()
            .expectHeader().valueEquals("Cache-Control", "no-store").expectBody().isEmpty();

        verifyNoInteractions(configurations);
        verify(roles).listDependenciesFlux(ROLE_NAMES);
    }

    @ParameterizedTest
    @MethodSource("serviceFailures")
    void shouldPreserveServiceStatusAndHideSynchronousAndDeferredErrorDetails(HttpStatus status,
        boolean synchronous) {
        permissions(nativeRule("get", "update"));
        var cause = new IllegalArgumentException(SECRET);
        RuntimeException error = status == HttpStatus.INTERNAL_SERVER_ERROR
            ? new IllegalStateException(SECRET, cause)
            : new ResponseStatusException(status, SECRET, cause);
        if (synchronous) {
            when(configurations.get(POLICY)).thenThrow(error);
            when(configurations.put(eq(POLICY), any())).thenThrow(error);
        } else {
            when(configurations.get(POLICY)).thenReturn(Mono.error(error));
            when(configurations.put(eq(POLICY), any())).thenReturn(Mono.error(error));
        }

        for (var principal : principals().toList()) {
            for (var route : routes().toList()) {
                exchange(principal, route).expectStatus().isEqualTo(status)
                    .expectHeader().valueEquals("Cache-Control", "no-store")
                    .expectBody().isEmpty();
            }
        }

        verify(configurations, times(3)).get(POLICY);
        verify(configurations, times(3)).put(POLICY, snapshot());
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void shouldHideRoleResolutionErrorsWithoutCallingTheService(boolean synchronous) {
        var error = new IllegalStateException(SECRET);
        if (synchronous) {
            when(roles.listDependenciesFlux(ROLE_NAMES)).thenThrow(error);
        } else {
            when(roles.listDependenciesFlux(ROLE_NAMES)).thenReturn(Flux.error(error));
        }

        for (var principal : principals().toList()) {
            for (var route : routes().toList()) {
                exchange(principal, route).expectStatus().is5xxServerError()
                    .expectHeader().valueEquals("Cache-Control", "no-store")
                    .expectBody().isEmpty();
            }
        }

        verifyNoInteractions(configurations);
    }

    private WebTestClient client(Principal principal) {
        return WebTestClient.bindToRouterFunction(endpoint.endpoint())
            .webFilter((exchange, chain) -> chain.filter(exchange.mutate()
                .principal(Mono.justOrEmpty(principal)).build()))
            .build();
    }

    private WebTestClient.ResponseSpec exchange(Principal principal, Route route) {
        return exchange(client(principal), route);
    }

    private WebTestClient.ResponseSpec exchange(WebTestClient client, Route route) {
        var request = client.method(route.method()).uri(PATH);
        if (route.equals(PUT)) {
            return request.contentType(MediaType.APPLICATION_JSON).bodyValue(BODY).exchange();
        }
        return request.exchange();
    }

    private void permissions(Role.PolicyRule... rules) {
        when(roles.listDependenciesFlux(ROLE_NAMES)).thenReturn(Flux.just(role(rules)));
    }

    private void stubConfiguration() {
        when(configurations.get(POLICY)).thenReturn(Mono.just(snapshot()));
        when(configurations.put(eq(POLICY), any())).thenReturn(Mono.empty());
    }

    private void verifyConfiguration(Route route, int count) {
        if (route.equals(GET)) {
            verify(configurations, times(count)).get(POLICY);
        } else {
            verify(configurations, times(count)).put(POLICY, snapshot());
        }
    }

    private static HttpStatus successStatus(Route route) {
        return route.equals(GET) ? HttpStatus.OK : HttpStatus.NO_CONTENT;
    }

    private static Role role(Role.PolicyRule... rules) {
        var role = new Role();
        role.setRules(List.of(rules));
        return role;
    }

    private static Role.PolicyRule nativeRule(String... verbs) {
        return new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP)
            .resources("policies/configs").verbs(verbs).build();
    }

    private static Authentication session() {
        return UsernamePasswordAuthenticationToken.authenticated("alice", "session-secret",
            List.of(new SimpleGrantedAuthority("ROLE_STORAGE_OPERATOR")));
    }

    private static Authentication pat(String... authorities) {
        var jwt = Jwt.withTokenValue("pat-secret").header("alg", "none")
            .claim("sub", "alice").claim("pat_name", "limited-pat")
            .claim("roles", List.of("owner-admin")).build();
        return new JwtAuthenticationToken(jwt,
            Arrays.stream(authorities).map(SimpleGrantedAuthority::new).toList(), "alice");
    }

    private static Authentication key(String... scopes) {
        var owner = User.withUsername("alice").password("owner-password")
            .authorities("ROLE_STORAGE_OPERATOR").build();
        return new CliKeyAuthenticationToken(owner, "key-one", "Automation", Set.of(scopes));
    }

    private static CliStorageConfigurationService.Snapshot snapshot() {
        return new CliStorageConfigurationService.Snapshot(7L, CONFIG_MAP, 11L,
            JSON.createObjectNode().put("accessKey", SECRET).put("region", "test"));
    }

    private static Stream<Authentication> principals() {
        return Stream.of(session(), pat("ROLE_STORAGE_OPERATOR"),
            key("policies:read", "policies:write"));
    }

    private static Stream<Route> routes() {
        return Stream.of(GET, PUT);
    }

    private static Stream<Role.PolicyRule> nonNativeRules() {
        return Stream.of(
            new Role.PolicyRule.Builder().apiGroups("console.api.halo-cli.halo.run")
                .resources("policies/configs").verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups("console.api.halo-cli.halo.run")
                .resources("*").verbs("*").build(),
            new Role.PolicyRule.Builder().apiGroups("").resources("configmaps")
                .verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP).resources("configmaps")
                .verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP).resources("policies")
                .verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups("storage.halo.run")
                .resources("policies/configs").verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP)
                .resources("policies/configs/default").verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP)
                .resources("*/configs").verbs("get", "update").build(),
            new Role.PolicyRule.Builder().nonResourceURLs(PATH, "/policies/*")
                .verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP).resources("policies/configs")
                .verbs("list", "create", "patch", "delete").build(),
            new Role.PolicyRule());
    }

    private static Stream<Role.PolicyRule> nativeWildcardRules() {
        return Stream.of(
            new Role.PolicyRule.Builder().apiGroups("*").resources("policies/configs")
                .verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP).resources("*")
                .verbs("get", "update").build(),
            new Role.PolicyRule.Builder().apiGroups(NATIVE_GROUP).resources("policies/configs")
                .verbs("*").build(),
            new Role.PolicyRule.Builder().apiGroups("*").resources("*").verbs("*").build());
    }

    private static Stream<Arguments> resourceNames() {
        return Stream.of(
            Arguments.of(List.of(), true),
            Arguments.of(List.of(POLICY), true),
            Arguments.of(List.of(POLICY + "/default"), true),
            Arguments.of(List.of("*"), true),
            Arguments.of(List.of(POLICY + "/*"), true),
            Arguments.of(List.of("policy-*"), true),
            Arguments.of(List.of("*-one"), true),
            Arguments.of(List.of("policy-*/def*"), true),
            Arguments.of(List.of("*-one/*fault"), true),
            Arguments.of(List.of(POLICY + "/default", "other-policy/private"), true),
            Arguments.of(List.of("other-policy"), false),
            Arguments.of(List.of(CONFIG_MAP), false),
            Arguments.of(List.of("other-policy/default"), false),
            Arguments.of(List.of("other-policy/*"), false),
            Arguments.of(List.of(POLICY + "/private"), false),
            Arguments.of(List.of("*/private"), false),
            Arguments.of(List.of("policy-*/private"), false),
            Arguments.of(List.of(POLICY + "/default/extra"), false),
            Arguments.of(List.of("other-policy", POLICY), false),
            Arguments.of(List.of(POLICY + "/private", POLICY + "/default"), false));
    }

    private static Stream<Set<String>> insufficientScopes() {
        return Stream.of(Set.of(), Set.of("posts:read", "posts:write"),
            Set.of("attachments:read", "attachments:write"), Set.of("policies:*"), Set.of("*"));
    }

    private static Stream<String> unsupportedPaths() {
        return Stream.of("/policies/" + POLICY + "/configs/private",
            "/policies/" + POLICY + "/configs/credentials",
            "/policies/" + POLICY + "/configs",
            PATH + "/extra", "/policies/" + POLICY + "/configs/defaults",
            "/configmaps/" + CONFIG_MAP,
            "/configmaps/" + CONFIG_MAP + "/configs/default",
            "/configmaps/" + CONFIG_MAP + "/default",
            "/policies/" + POLICY + "/configmaps/" + CONFIG_MAP + "/default");
    }

    private static Stream<String> invalidBodies() throws Exception {
        var bodies = new ArrayList<>(List.of("", " ", "null", "[]", "true", "7", "{}", "{",
            "\"" + SECRET + "\"", "{\"config\":\"" + SECRET,
            BODY + "{}", BODY + "null", BODY + SECRET));
        var valid = (ObjectNode) JSON.readTree(BODY);
        for (var field : List.of("policyVersion", "configMapName", "configMapVersion", "config")) {
            var missing = valid.deepCopy();
            missing.remove(field);
            bodies.add(missing.toString());
        }
        for (var field : List.of("policyVersion", "configMapVersion")) {
            for (var value : List.of("\"7\"", "true", "[]", "{}", "7.5", "7.0",
                "9223372036854775808", "-9223372036854775809")) {
                var invalid = valid.deepCopy();
                invalid.set(field, JSON.readTree(value));
                bodies.add(invalid.toString());
            }
        }
        var nullPolicyVersion = valid.deepCopy();
        nullPolicyVersion.putNull("policyVersion");
        bodies.add(nullPolicyVersion.toString());
        for (var value : List.of("7", "true", "[]", "{}")) {
            var invalid = valid.deepCopy();
            invalid.set("configMapName", JSON.readTree(value));
            bodies.add(invalid.toString());
        }
        for (var value : List.of("null", "[]", "\"" + SECRET + "\"", "7", "true")) {
            var invalid = valid.deepCopy();
            invalid.set("config", JSON.readTree(value));
            bodies.add(invalid.toString());
        }
        return bodies.stream();
    }

    private static Stream<Arguments> serviceFailures() {
        return Stream.of(HttpStatus.BAD_REQUEST, HttpStatus.NOT_FOUND, HttpStatus.CONFLICT,
                HttpStatus.INTERNAL_SERVER_ERROR)
            .flatMap(status -> Stream.of(Arguments.of(status, false), Arguments.of(status, true)));
    }

    private record Route(HttpMethod method, String verb, String scope) {
    }
}
