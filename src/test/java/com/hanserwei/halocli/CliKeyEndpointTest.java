package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.security.Principal;
import java.time.Instant;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.authentication.AnonymousAuthenticationToken;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.userdetails.User;
import org.springframework.test.web.reactive.server.WebTestClient;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.GroupVersion;
import run.halo.app.extension.Metadata;

class CliKeyEndpointTest {
    private static final String BODY = """
        {"displayName":"Automation","scopes":["posts:read"],
         "allowedIpRanges":["203.0.113.0/24"],"expiresAt":null}
        """;
    private static final String RAW_TOKEN = "hcli_new-once-only-secret";
    private static final String HASH = "stored-hash-must-never-leave-storage";
    private final CliAccessKeyService keys = mock(CliAccessKeyService.class);
    private final CliScopePolicy policy = new CliScopePolicy();
    private final CliKeyEndpoint endpoint = new CliKeyEndpoint(keys, policy);

    @Test
    void shouldUsePluginApiGroup() {
        assertThat(endpoint.groupVersion())
            .isEqualTo(new GroupVersion("console.api.halo-cli.halo.run", "v1alpha1"));
    }

    @Test
    void shouldListSafeViewsAsAnArrayUsingThePrincipalOwner() {
        when(keys.list("alice")).thenReturn(Flux.just(view()));

        client(session()).get().uri("/keys?ownerName=mallory&owner=mallory")
            .exchange().expectStatus().isOk()
            .expectHeader().valueEquals("Cache-Control", "no-store")
            .expectBody()
            .jsonPath("$[0].name").isEqualTo("key-one")
            .jsonPath("$[0].ownerName").isEqualTo("alice")
            .jsonPath("$[0].keyPrefix").isEqualTo("hcli_key-one")
            .jsonPath("$[0].createdAt").isEqualTo("2026-01-01T00:00:00Z")
            .jsonPath("$[0].keyHash").doesNotExist()
            .jsonPath("$[0].token").doesNotExist()
            .consumeWith(result -> assertThat(new String(result.getResponseBody(),
                java.nio.charset.StandardCharsets.UTF_8))
                .doesNotContain(HASH, "keyHash", RAW_TOKEN, "\"spec\""));

        verify(keys).list("alice");
    }

    @Test
    void shouldReturnAnEmptyArray() {
        when(keys.list("alice")).thenReturn(Flux.empty());
        client(session()).get().uri("/keys").exchange()
            .expectStatus().isOk().expectBody().json("[]");
    }

    @Test
    void shouldExposeTheScopeCatalogAsAnArray() {
        client(session()).get().uri("/scopes").exchange()
            .expectStatus().isOk()
            .expectBodyList(CliScopePolicy.Scope.class)
            .value(scopes -> assertThat(scopes).containsExactlyElementsOf(policy.scopes()));
        verifyNoInteractions(keys);
    }

    @Test
    void shouldCreateForPrincipalAndReturnTheTokenOnlyWithTheSafeView() {
        var input = new CliAccessKeyService.KeyInput("Automation", Set.of("posts:read"),
            Set.of("203.0.113.0/24"), null, null);
        when(keys.create(eq("alice"), any()))
            .thenReturn(Mono.just(new CliAccessKeyService.CreatedKey(view(), RAW_TOKEN)));

        client(session()).post().uri("/keys?ownerName=mallory")
            .contentType(MediaType.APPLICATION_JSON).bodyValue(BODY)
            .exchange().expectStatus().isCreated()
            .expectHeader().valueEquals("Cache-Control", "no-store")
            .expectBody()
            .jsonPath("$.key.ownerName").isEqualTo("alice")
            .jsonPath("$.key.name").isEqualTo("key-one")
            .jsonPath("$.token").isEqualTo(RAW_TOKEN)
            .jsonPath("$.key.keyHash").doesNotExist()
            .consumeWith(result -> assertThat(new String(result.getResponseBody(),
                java.nio.charset.StandardCharsets.UTF_8)).doesNotContain(HASH, "keyHash"));

        verify(keys).create("alice", input);
    }

    @Test
    void shouldUpdateUsingPrincipalAndPreserveExplicitNullExpiryAndDisabledState() {
        when(keys.update(eq("alice"), eq("key-one"), any())).thenReturn(Mono.just(view()));
        var body = """
            {"displayName":"Updated","scopes":["posts:read"],"allowedIpRanges":[],
             "expiresAt":null,"enabled":false}
            """;
        client(session()).put().uri("/keys/key-one?ownerName=mallory")
            .contentType(MediaType.APPLICATION_JSON).bodyValue(body)
            .exchange().expectStatus().isOk()
            .expectBody()
            .jsonPath("$.name").isEqualTo("key-one")
            .jsonPath("$.keyHash").doesNotExist()
            .jsonPath("$.token").doesNotExist();

        verify(keys).update("alice", "key-one", new CliAccessKeyService.KeyInput(
            "Updated", Set.of("posts:read"), Set.of(), null, false));
    }

    @Test
    void shouldParseIsoExpiry() {
        when(keys.create(eq("alice"), any()))
            .thenReturn(Mono.just(new CliAccessKeyService.CreatedKey(view(), RAW_TOKEN)));
        client(session()).post().uri("/keys").contentType(MediaType.APPLICATION_JSON)
            .bodyValue("""
                {"displayName":"Timed","scopes":["posts:read"],
                 "expiresAt":"2099-01-01T00:00:00Z"}
                """)
            .exchange().expectStatus().isCreated();
        verify(keys).create("alice", new CliAccessKeyService.KeyInput("Timed",
            Set.of("posts:read"), null, Instant.parse("2099-01-01T00:00:00Z"), null));
    }

    @Test
    void shouldRotateForPrincipalAndReturnANewToken() {
        when(keys.rotate("alice", "key-one"))
            .thenReturn(Mono.just(new CliAccessKeyService.CreatedKey(view(), RAW_TOKEN)));
        client(session()).post().uri("/keys/key-one/rotate?ownerName=mallory")
            .exchange().expectStatus().isOk()
            .expectHeader().valueEquals("Cache-Control", "no-store")
            .expectBody()
            .jsonPath("$.key.name").isEqualTo("key-one")
            .jsonPath("$.token").isEqualTo(RAW_TOKEN)
            .jsonPath("$.key.keyHash").doesNotExist()
            .consumeWith(result -> assertThat(new String(result.getResponseBody(),
                java.nio.charset.StandardCharsets.UTF_8)).doesNotContain(HASH, "keyHash"));
        verify(keys).rotate("alice", "key-one");
    }

    @Test
    void shouldDeleteForPrincipalAndReturnNoContent() {
        when(keys.delete("alice", "key-one")).thenReturn(Mono.empty());
        client(session()).delete().uri("/keys/key-one?ownerName=mallory")
            .exchange().expectStatus().isNoContent().expectBody().isEmpty();
        verify(keys).delete("alice", "key-one");
    }

    @Test
    void shouldReportSessionIdentityIncludingExplicitNullKeyFields() {
        client(session()).get().uri("/auth/me").exchange()
            .expectStatus().isOk()
            .expectBody()
            .json("""
                {"username":"alice","keyName":null,"keyDisplayName":null,"scopes":[]}
                """)
            .jsonPath("$.keyName").hasJsonPath()
            .jsonPath("$.keyDisplayName").hasJsonPath();
        verifyNoInteractions(keys);
    }

    @Test
    void shouldReportKeyIdentityWithoutCredentialsOrAuthorities() {
        client(keyAuthentication()).get().uri("/auth/me").exchange()
            .expectStatus().isOk()
            .expectBody().json("""
                {"username":"alice","keyName":"key-one","keyDisplayName":"Automation",
                 "scopes":["posts:read"]}
                """)
            .jsonPath("$.credentials").doesNotExist()
            .jsonPath("$.authorities").doesNotExist()
            .jsonPath("$.keyHash").doesNotExist();
        verifyNoInteractions(keys);
    }

    @ParameterizedTest
    @MethodSource("managementRoutes")
    void shouldRejectKeyAuthenticationOnEveryManagementRoute(Route route) {
        client(keyAuthentication()).method(route.method()).uri(route.path())
            .contentType(MediaType.APPLICATION_JSON).bodyValue(BODY)
            .exchange().expectStatus().isForbidden();
        verifyNoInteractions(keys);
    }

    @ParameterizedTest
    @MethodSource("allRoutes")
    void shouldRequireAnAuthenticatedPrincipalOnEveryRoute(Route route) {
        var anonymous = new AnonymousAuthenticationToken("anonymous", "anonymousUser",
            List.of(new SimpleGrantedAuthority("ROLE_ANONYMOUS")));
        Principal[] rejected = {null, anonymous,
            UsernamePasswordAuthenticationToken.unauthenticated("alice", "password"),
            (Principal) () -> "alice"};
        for (var principal : rejected) {
            client(principal).method(route.method()).uri(route.path())
                .contentType(MediaType.APPLICATION_JSON).bodyValue(BODY)
                .exchange().expectStatus().isUnauthorized();
        }
        verifyNoInteractions(keys);
    }

    @ParameterizedTest
    @MethodSource("invalidBodies")
    void shouldRejectInvalidAndUnknownJsonOnBothWriteRoutes(String body) {
        for (var route : List.of(new Route(HttpMethod.POST, "/keys"),
            new Route(HttpMethod.PUT, "/keys/key-one"))) {
            client(session()).method(route.method()).uri(route.path())
                .contentType(MediaType.APPLICATION_JSON).bodyValue(body)
                .exchange().expectStatus().isBadRequest();
        }
        verifyNoInteractions(keys);
    }

    @Test
    void shouldRejectMissingBodies() {
        client(session()).post().uri("/keys").exchange().expectStatus().isBadRequest();
        client(session()).put().uri("/keys/key-one").exchange().expectStatus().isBadRequest();
        verifyNoInteractions(keys);
    }

    @Test
    void shouldMapBothDeferredAndSynchronousServiceValidationToBadRequest() {
        when(keys.create(eq("alice"), any()))
            .thenReturn(Mono.error(new IllegalArgumentException("Invalid scopes")));
        when(keys.update(eq("alice"), eq("key-one"), any()))
            .thenThrow(new IllegalArgumentException("Invalid IP range"));
        client(session()).post().uri("/keys").contentType(MediaType.APPLICATION_JSON)
            .bodyValue(BODY).exchange().expectStatus().isBadRequest();
        client(session()).put().uri("/keys/key-one").contentType(MediaType.APPLICATION_JSON)
            .bodyValue(BODY).exchange().expectStatus().isBadRequest();
    }

    @Test
    void shouldPreserveServiceNotFoundForForeignOrMissingKeys() {
        var notFound = new ResponseStatusException(HttpStatus.NOT_FOUND, "CLI key not found");
        when(keys.update(eq("alice"), eq("foreign-key"), any()))
            .thenReturn(Mono.error(notFound));
        when(keys.rotate("alice", "foreign-key")).thenReturn(Mono.error(notFound));
        when(keys.delete("alice", "foreign-key")).thenReturn(Mono.error(notFound));
        var client = client(session());
        client.put().uri("/keys/foreign-key").contentType(MediaType.APPLICATION_JSON)
            .bodyValue(BODY).exchange().expectStatus().isNotFound();
        client.post().uri("/keys/foreign-key/rotate").exchange().expectStatus().isNotFound();
        client.delete().uri("/keys/foreign-key").exchange().expectStatus().isNotFound();
    }

    private WebTestClient client(Principal principal) {
        return WebTestClient.bindToRouterFunction(endpoint.endpoint())
            .webFilter((exchange, chain) -> chain.filter(exchange.mutate()
                .principal(Mono.justOrEmpty(principal)).build()))
            .build();
    }

    private static Authentication session() {
        return UsernamePasswordAuthenticationToken.authenticated("alice", "session-secret", List.of());
    }

    private static Authentication keyAuthentication() {
        var owner = User.withUsername("alice").password("owner-password").authorities("ROLE_OWNER")
            .build();
        return new CliKeyAuthenticationToken(owner, "key-one", "Automation", Set.of("posts:read"));
    }

    private static CliAccessKeyService.KeyView view() {
        var stored = new CliAccessKey();
        var metadata = new Metadata();
        metadata.setName("key-one");
        metadata.setCreationTimestamp(Instant.parse("2026-01-01T00:00:00Z"));
        stored.setMetadata(metadata);
        stored.getSpec().setOwnerName("alice");
        stored.getSpec().setDisplayName("Automation");
        stored.getSpec().setKeyHash(HASH);
        stored.getSpec().setKeyPrefix("hcli_key-one");
        stored.getSpec().setScopes(Set.of("posts:read"));
        return CliAccessKeyService.view(stored);
    }

    private static Stream<Route> managementRoutes() {
        return Stream.of(new Route(HttpMethod.GET, "/keys"),
            new Route(HttpMethod.GET, "/scopes"), new Route(HttpMethod.POST, "/keys"),
            new Route(HttpMethod.PUT, "/keys/key-one"),
            new Route(HttpMethod.POST, "/keys/key-one/rotate"),
            new Route(HttpMethod.DELETE, "/keys/key-one"));
    }

    private static Stream<Route> allRoutes() {
        return Stream.concat(managementRoutes(), Stream.of(new Route(HttpMethod.GET, "/auth/me")));
    }

    private static Stream<String> invalidBodies() {
        return Stream.of("", "null", "[]", "{", "\"text\"", "{} {}",
            "{\"displayName\":\"Automation\",\"scopes\":{}}",
            "{\"displayName\":\"Automation\",\"expiresAt\":\"not-a-date\"}",
            "{\"displayName\":\"Automation\",\"enabled\":{}}",
            "{\"displayName\":\"Automation\",\"allowedIpRanges\":{}}",
            "{\"displayName\":\"Automation\",\"ownerName\":\"mallory\"}",
            "{\"displayName\":\"Automation\",\"owner\":\"mallory\"}",
            "{\"displayName\":\"Automation\",\"keyHash\":\"chosen-hash\"}",
            "{\"displayName\":\"Automation\",\"keyPrefix\":\"chosen-prefix\"}",
            "{\"displayName\":\"Automation\",\"unexpected\":true}");
    }

    private record Route(HttpMethod method, String path) {
    }
}
