package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Set;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.GrantedAuthority;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.userdetails.ReactiveUserDetailsService;
import org.springframework.security.core.userdetails.User;
import org.springframework.security.core.userdetails.UserDetails;
import org.springframework.security.core.userdetails.UsernameNotFoundException;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;

class CliKeyAuthenticationFilterTest {
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final String RAW_KEY = "hcli_cli-key.test-secret";
    private static final String KEY_NAME = "cli-key";
    private static final String OWNER_NAME = "key-owner";
    private static final String POST_PATH = "/apis/content.halo.run/v1alpha1/posts/example";
    private static final InetSocketAddress REMOTE_ADDRESS =
        new InetSocketAddress("192.0.2.10", 54321);

    private final CliAccessKeyService keys = mock(CliAccessKeyService.class);
    private final ReactiveUserDetailsService owners = mock(ReactiveUserDetailsService.class);
    private final CliKeyAuthenticationFilter filter =
        new CliKeyAuthenticationFilter(keys, owners, new CliScopePolicy(), request -> REMOTE_ADDRESS);

    private static Stream<Arguments> allowedRequests() {
        return Stream.of(
            Arguments.of(HttpMethod.GET, "posts:read"),
            Arguments.of(HttpMethod.PUT, "posts:write"));
    }

    @ParameterizedTest
    @MethodSource("allowedRequests")
    void shouldPassCurrentOwnerIdentityWithoutCredentialsAndPreserveRequest(
        HttpMethod method, String scope) {
        var owner = owner("ROLE_editor", "posts:view");
        var key = verifiedKey(Set.of(scope));
        stubKey(key);
        when(owners.findByUsername(OWNER_NAME)).thenReturn(Mono.just(owner));
        when(keys.recordUse(KEY_NAME)).thenReturn(Mono.empty());
        var exchange = exchange(method, POST_PATH + "?page=2&label=a%2Fb", "Bearer " + RAW_KEY);
        var session = sessionAuthentication();
        var chainCalls = new AtomicInteger();
        var chainSubscriptions = new AtomicInteger();
        var observed = new AtomicReference<Authentication>();
        WebFilterChain chain = downstream -> {
            chainCalls.incrementAndGet();
            assertThat(downstream.getRequest().getHeaders()
                .getFirst(HttpHeaders.AUTHORIZATION)).isNull();
            assertThat(downstream.getRequest().getHeaders().getFirst("X-Request-Id"))
                .isEqualTo("filter-test");
            assertThat(downstream.getRequest().getMethod()).isEqualTo(method);
            assertThat(downstream.getRequest().getURI()).isEqualTo(exchange.getRequest().getURI());
            assertThat(downstream.getRequest().getURI().getRawPath()).isEqualTo(POST_PATH);
            assertThat(downstream.getRequest().getRemoteAddress()).isEqualTo(REMOTE_ADDRESS);
            return Mono.defer(() -> {
                chainSubscriptions.incrementAndGet();
                return ReactiveSecurityContextHolder.getContext()
                    .switchIfEmpty(Mono.error(new AssertionError("Missing owner security context")))
                    .flatMap(context -> {
                        observed.set(context.getAuthentication());
                        downstream.getResponse().setStatusCode(HttpStatus.NO_CONTENT);
                        return downstream.getResponse().setComplete();
                    });
            });
        };

        filter.filter(exchange, chain)
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(session))
            .block(TIMEOUT);

        assertThat(observed.get()).isInstanceOf(CliKeyAuthenticationToken.class).isNotSameAs(session);
        var authentication = (CliKeyAuthenticationToken) observed.get();
        assertThat(authentication.isAuthenticated()).isTrue();
        assertThat(authentication.getPrincipal()).isSameAs(owner);
        assertThat(authentication.getName()).isEqualTo(OWNER_NAME);
        assertThat(authentication.getAuthorities()).extracting(GrantedAuthority::getAuthority)
            .containsExactlyElementsOf(owner.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority).toList())
            .doesNotContain("ROLE_super");
        assertThat(authentication.getCredentials()).isNull();
        assertThat(authentication.keyName()).isEqualTo(KEY_NAME);
        assertThat(authentication.keyDisplayName()).isEqualTo("Deployment key");
        assertThat(authentication.scopes()).containsExactly(scope);
        assertThat(exchange.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION))
            .isEqualTo("Bearer " + RAW_KEY);
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(chainCalls).hasValue(1);
        assertThat(chainSubscriptions).hasValue(1);
        verify(keys, times(2)).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(owners).findByUsername(OWNER_NAME);
        verify(keys).recordUse(KEY_NAME);
    }

    @Test
    void shouldReloadOwnerAuthoritiesForEveryRequest() {
        stubKey(verifiedKey(Set.of("posts:read")));
        var originalOwner = owner("ROLE_editor", "posts:edit");
        var currentOwner = owner("ROLE_viewer");
        when(owners.findByUsername(OWNER_NAME))
            .thenReturn(Mono.just(originalOwner), Mono.just(currentOwner));
        when(keys.recordUse(KEY_NAME)).thenReturn(Mono.empty());
        var observed = new ArrayList<Authentication>();
        WebFilterChain chain = downstream -> ReactiveSecurityContextHolder.getContext()
            .switchIfEmpty(Mono.error(new AssertionError("Missing owner security context")))
            .doOnNext(context -> observed.add(context.getAuthentication())).then();

        filter.filter(exchange(HttpMethod.GET, POST_PATH, "Bearer " + RAW_KEY), chain).block(TIMEOUT);
        filter.filter(exchange(HttpMethod.GET, POST_PATH, "Bearer " + RAW_KEY), chain).block(TIMEOUT);

        assertThat(observed).hasSize(2);
        assertThat(observed.get(0).getPrincipal()).isSameAs(originalOwner);
        assertThat(observed.get(1).getPrincipal()).isSameAs(currentOwner);
        assertThat(observed.get(1).getAuthorities()).extracting(GrantedAuthority::getAuthority)
            .containsExactlyElementsOf(currentOwner.getAuthorities().stream()
                .map(GrantedAuthority::getAuthority).toList());
        verify(owners, times(2)).findByUsername(OWNER_NAME);
        verify(keys, times(4)).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(keys, times(2)).recordUse(KEY_NAME);
    }

    @ParameterizedTest
    @ValueSource(strings = {"disabled", "locked", "accountExpired", "credentialsExpired", "missing",
        "notFound"})
    void shouldRejectUnavailableOwnerWithoutFallingBackToSession(String state) {
        stubKey(verifiedKey(Set.of("posts:read")));
        Mono<UserDetails> lookup;
        if (state.equals("missing")) {
            lookup = Mono.empty();
        } else if (state.equals("notFound")) {
            lookup = Mono.error(new UsernameNotFoundException("Owner was deleted"));
        } else {
            lookup = Mono.just(User.withUsername(OWNER_NAME).password("unused")
                .authorities("ROLE_editor")
                .disabled(state.equals("disabled"))
                .accountLocked(state.equals("locked"))
                .accountExpired(state.equals("accountExpired"))
                .credentialsExpired(state.equals("credentialsExpired"))
                .build());
        }
        when(owners.findByUsername(OWNER_NAME)).thenReturn(lookup);
        var exchange = exchange(HttpMethod.GET, POST_PATH, "Bearer " + RAW_KEY);
        var chainCalls = new AtomicInteger();

        filter.filter(exchange, countingChain(chainCalls))
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(sessionAuthentication()))
            .block(TIMEOUT);

        assertRejected(exchange, chainCalls, HttpStatus.UNAUTHORIZED);
        verify(owners).findByUsername(OWNER_NAME);
        verify(keys).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(keys, never()).recordUse(KEY_NAME);
    }

    @Test
    void shouldDenyMissingScopeEvenWhenOwnerIsSuper() {
        stubKey(verifiedKey(Set.of("posts:read")));
        when(owners.findByUsername(OWNER_NAME)).thenReturn(Mono.just(owner("ROLE_super")));
        var exchange = exchange(HttpMethod.PUT, POST_PATH, "Bearer " + RAW_KEY);
        var chainCalls = new AtomicInteger();

        filter.filter(exchange, countingChain(chainCalls))
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(sessionAuthentication()))
            .block(TIMEOUT);

        assertRejected(exchange, chainCalls, HttpStatus.FORBIDDEN);
        verify(keys, times(2)).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(owners).findByUsername(OWNER_NAME);
        verify(keys, never()).recordUse(KEY_NAME);
    }

    @Test
    void shouldRejectKeyRevokedWhileOwnerLookupIsPending() throws Exception {
        var revoked = new AtomicBoolean();
        var key = verifiedKey(Set.of("posts:read"));
        when(keys.authenticate(RAW_KEY, REMOTE_ADDRESS)).thenAnswer(ignored ->
            Mono.defer(() -> revoked.get() ? Mono.empty() : Mono.just(key)));
        var ownerLookup = Sinks.<UserDetails>one();
        when(owners.findByUsername(OWNER_NAME)).thenReturn(ownerLookup.asMono());
        var exchange = exchange(HttpMethod.GET, POST_PATH, "Bearer " + RAW_KEY);
        var chainCalls = new AtomicInteger();
        var completion = filter.filter(exchange, countingChain(chainCalls))
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(sessionAuthentication()))
            .toFuture();

        assertThat(completion).isNotDone();
        verify(keys).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(owners).findByUsername(OWNER_NAME);
        assertThat(chainCalls).hasValue(0);
        revoked.set(true);
        assertThat(ownerLookup.tryEmitValue(owner("ROLE_editor"))).isEqualTo(Sinks.EmitResult.OK);
        completion.get(TIMEOUT.toMillis(), TimeUnit.MILLISECONDS);

        assertRejected(exchange, chainCalls, HttpStatus.UNAUTHORIZED);
        var order = inOrder(keys, owners);
        order.verify(keys).authenticate(RAW_KEY, REMOTE_ADDRESS);
        order.verify(owners).findByUsername(OWNER_NAME);
        order.verify(keys).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(keys, never()).recordUse(KEY_NAME);
    }

    @Test
    void shouldEnforceScopesFromKeyRecheckAfterOwnerLookup() {
        when(keys.authenticate(RAW_KEY, REMOTE_ADDRESS)).thenReturn(
            Mono.just(verifiedKey(Set.of("posts:read", "posts:write"))),
            Mono.just(verifiedKey(Set.of("posts:read"))));
        when(owners.findByUsername(OWNER_NAME)).thenReturn(Mono.just(owner("ROLE_super")));
        var exchange = exchange(HttpMethod.PUT, POST_PATH, "Bearer " + RAW_KEY);
        var chainCalls = new AtomicInteger();

        filter.filter(exchange, countingChain(chainCalls)).block(TIMEOUT);

        assertRejected(exchange, chainCalls, HttpStatus.FORBIDDEN);
        verify(keys, times(2)).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(keys, never()).recordUse(KEY_NAME);
    }

    @Test
    void shouldRejectKeyReassignedToAnotherOwnerDuringLookup() {
        when(keys.authenticate(RAW_KEY, REMOTE_ADDRESS)).thenReturn(
            Mono.just(verifiedKey(Set.of("posts:read"))),
            Mono.just(new CliAccessKeyService.VerifiedKey(KEY_NAME, "Deployment key", "another-owner",
                Set.of("posts:read"))));
        when(owners.findByUsername(OWNER_NAME)).thenReturn(Mono.just(owner("ROLE_editor")));
        var exchange = exchange(HttpMethod.GET, POST_PATH, "Bearer " + RAW_KEY);
        var chainCalls = new AtomicInteger();

        filter.filter(exchange, countingChain(chainCalls)).block(TIMEOUT);

        assertRejected(exchange, chainCalls, HttpStatus.UNAUTHORIZED);
        verify(keys, times(2)).authenticate(RAW_KEY, REMOTE_ADDRESS);
        verify(keys, never()).recordUse(KEY_NAME);
    }

    private static Stream<Arguments> ambiguousAuthorizationHeaders() {
        var cli = "Bearer " + RAW_KEY;
        var pat = "Bearer ordinary-pat";
        return Stream.of(
            Arguments.of("CLI then PAT", List.of(cli, pat)),
            Arguments.of("PAT then CLI", List.of(pat, cli)),
            Arguments.of("duplicate CLI", List.of(cli, cli)),
            Arguments.of("Basic then CLI", List.of("Basic dXNlcjpwYXNz", cli)));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("ambiguousAuthorizationHeaders")
    void shouldRejectMultipleAuthorizationHeadersWithoutSessionFallback(String description,
        List<String> headers) {
        var exchange = exchange(HttpMethod.GET, POST_PATH, headers.toArray(String[]::new));
        var chainCalls = new AtomicInteger();

        filter.filter(exchange, countingChain(chainCalls))
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(sessionAuthentication()))
            .block(TIMEOUT);

        assertRejected(exchange, chainCalls, HttpStatus.UNAUTHORIZED);
        verifyNoInteractions(keys, owners);
    }

    @Test
    void shouldLeaveOrdinaryPatAndExistingSecurityContextUntouched() {
        // This route is outside CLI scopes; the normal Halo security chain must decide access.
        var exchange = exchange(HttpMethod.DELETE, "/api/v1alpha1/users/example", "Bearer ordinary-pat");
        var existingAuthentication = sessionAuthentication();
        var chainCalls = new AtomicInteger();
        var observed = new AtomicReference<Authentication>();
        WebFilterChain chain = downstream -> {
            chainCalls.incrementAndGet();
            assertThat(downstream).isSameAs(exchange);
            assertThat(downstream.getRequest().getHeaders().getFirst(HttpHeaders.AUTHORIZATION))
                .isEqualTo("Bearer ordinary-pat");
            return ReactiveSecurityContextHolder.getContext()
                .doOnNext(context -> observed.set(context.getAuthentication())).then();
        };

        filter.filter(exchange, chain)
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(existingAuthentication))
            .block(TIMEOUT);

        assertThat(chainCalls).hasValue(1);
        assertThat(observed.get()).isSameAs(existingAuthentication);
        assertThat(exchange.getResponse().getStatusCode()).isNull();
        verifyNoInteractions(keys, owners);
    }

    private static Stream<Arguments> downstreamFailures() {
        return Stream.of(
            Arguments.of(new IllegalStateException("Handler failed")),
            Arguments.of(new ResponseStatusException(HttpStatus.FORBIDDEN, "Halo RBAC denied access")),
            Arguments.of(new BadCredentialsException("Downstream authentication failed")));
    }

    @ParameterizedTest
    @MethodSource("downstreamFailures")
    void shouldPropagateDownstreamFailureWithoutConvertingItToUnauthorized(RuntimeException failure) {
        stubKey(verifiedKey(Set.of("posts:read")));
        when(owners.findByUsername(OWNER_NAME)).thenReturn(Mono.just(owner("ROLE_editor")));
        when(keys.recordUse(KEY_NAME)).thenReturn(Mono.empty());
        var exchange = exchange(HttpMethod.GET, POST_PATH, "Bearer " + RAW_KEY);
        var chainCalls = new AtomicInteger();
        WebFilterChain chain = downstream -> {
            chainCalls.incrementAndGet();
            return Mono.error(failure);
        };

        assertThatThrownBy(() -> filter.filter(exchange, chain).block(TIMEOUT)).isSameAs(failure);

        assertThat(chainCalls).hasValue(1);
        assertThat(exchange.getResponse().getStatusCode()).isNull();
        assertThat(exchange.getResponse().getHeaders().getFirst(HttpHeaders.WWW_AUTHENTICATE)).isNull();
        verify(keys).recordUse(KEY_NAME);
    }

    private void stubKey(CliAccessKeyService.VerifiedKey key) {
        when(keys.authenticate(RAW_KEY, REMOTE_ADDRESS)).thenReturn(Mono.just(key));
    }

    private static CliAccessKeyService.VerifiedKey verifiedKey(Set<String> scopes) {
        return new CliAccessKeyService.VerifiedKey(KEY_NAME, "Deployment key", OWNER_NAME, scopes);
    }

    private static UserDetails owner(String... authorities) {
        return User.withUsername(OWNER_NAME).password("unused").authorities(authorities).build();
    }

    private static Authentication sessionAuthentication() {
        var user = User.withUsername("session-admin").password("unused")
            .authorities("ROLE_super").build();
        return new UsernamePasswordAuthenticationToken(user, null, user.getAuthorities());
    }

    private static MockServerWebExchange exchange(HttpMethod method, String uri, String... headers) {
        return MockServerWebExchange.from(MockServerHttpRequest.method(method, uri)
            .remoteAddress(REMOTE_ADDRESS)
            .header(HttpHeaders.AUTHORIZATION, headers)
            .header("X-Request-Id", "filter-test")
            .build());
    }

    private static WebFilterChain countingChain(AtomicInteger calls) {
        return downstream -> {
            calls.incrementAndGet();
            return Mono.empty();
        };
    }

    private static void assertRejected(MockServerWebExchange exchange, AtomicInteger chainCalls,
        HttpStatus status) {
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(status);
        assertThat(exchange.getResponse().getHeaders().getCacheControl()).isEqualTo("no-store");
        if (status == HttpStatus.UNAUTHORIZED) {
            assertThat(exchange.getResponse().getHeaders().getFirst(HttpHeaders.WWW_AUTHENTICATE))
                .isEqualTo("Bearer");
        } else {
            assertThat(exchange.getResponse().getHeaders()
                .getFirst(HttpHeaders.WWW_AUTHENTICATE)).isNull();
        }
        assertThat(chainCalls).hasValue(0);
    }
}
