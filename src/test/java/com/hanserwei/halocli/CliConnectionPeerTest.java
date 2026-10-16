package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import io.netty.channel.Channel;
import java.net.InetSocketAddress;
import java.time.Duration;
import java.util.Set;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.AbstractServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.core.userdetails.ReactiveUserDetailsService;
import org.springframework.security.core.userdetails.User;
import reactor.core.publisher.Mono;
import reactor.netty.Connection;
import reactor.netty.http.server.HttpServerRequest;
import run.halo.app.extension.ReactiveExtensionClient;

class CliConnectionPeerTest {
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final InetSocketAddress ALLOWED = new InetSocketAddress("192.0.2.10", 12345);
    private static final InetSocketAddress OUTSIDE = new InetSocketAddress("198.51.100.10", 23456);
    private static final String PATH = "/apis/content.halo.run/v1alpha1/posts/example";

    @Test
    void unwrapsDecoratorsAndUsesChannelPeerInsteadOfForwardedRemoteAddress() {
        var nativeRequest = nativeRequest(OUTSIDE);
        when(nativeRequest.remoteAddress()).thenReturn(ALLOWED);
        var carrier = nativeCarrier(nativeRequest);
        when(carrier.getRemoteAddress()).thenReturn(ALLOWED);
        var decorated = new ServerHttpRequestDecorator(new ServerHttpRequestDecorator(carrier));

        assertThat(CliConnectionPeer.resolve(decorated)).isEqualTo(OUTSIDE);
        verify(nativeRequest, never()).remoteAddress();
        verify(carrier, never()).getRemoteAddress();
    }

    @Test
    void rejectsForgedForwardingHeadersWhenRealConnectionIsOutsideAllowlist() {
        var fixture = new Fixture(Set.of("192.0.2.10"));
        var nativeRequest = nativeRequest(OUTSIDE);
        when(nativeRequest.remoteAddress()).thenReturn(ALLOWED);
        var carrier = nativeCarrier(nativeRequest);
        var filter = fixture.filter(request -> CliConnectionPeer.resolve(carrier));
        var exchange = fixture.forwardedExchange(ALLOWED);
        var calls = new AtomicInteger();

        filter.filter(exchange, ignored -> {
            calls.incrementAndGet();
            return Mono.empty();
        }).block(TIMEOUT);

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(calls).hasValue(0);
        verifyNoInteractions(fixture.owners);
        verify(nativeRequest, never()).remoteAddress();
    }

    @Test
    void allowsListedDirectPeerEvenWhenForwardingHeadersClaimAnotherAddress() {
        var fixture = new Fixture(Set.of("192.0.2.10"));
        var carrier = nativeCarrier(nativeRequest(ALLOWED));
        var filter = fixture.filter(request -> CliConnectionPeer.resolve(carrier));
        var exchange = fixture.forwardedExchange(OUTSIDE);
        var calls = new AtomicInteger();

        filter.filter(exchange, ignored -> {
            calls.incrementAndGet();
            return Mono.empty();
        }).block(TIMEOUT);

        assertThat(calls).hasValue(1);
        assertThat(exchange.getResponse().getStatusCode()).isNull();
    }

    @Test
    void unknownTransportFailsClosedForConfiguredIpRulesDespiteAllowedRemoteAddress() {
        var fixture = new Fixture(Set.of("192.0.2.10"));
        // Production constructor: a Mock transport has no native connection to authenticate.
        var filter = new CliKeyAuthenticationFilter(fixture.keys, fixture.owners, fixture.policy);
        var exchange = fixture.forwardedExchange(ALLOWED);
        var calls = new AtomicInteger();

        assertThat(CliConnectionPeer.resolve(exchange.getRequest())).isNull();
        filter.filter(exchange, ignored -> {
            calls.incrementAndGet();
            return Mono.empty();
        }).block(TIMEOUT);

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
        assertThat(calls).hasValue(0);
        verifyNoInteractions(fixture.owners);
    }

    @Test
    void emptyIpRulesStillAllowAuthenticationWhenTransportPeerIsUnavailable() {
        var fixture = new Fixture(Set.of());
        var filter = new CliKeyAuthenticationFilter(fixture.keys, fixture.owners, fixture.policy);
        var exchange = fixture.forwardedExchange(ALLOWED);
        var calls = new AtomicInteger();

        filter.filter(exchange, ignored -> {
            calls.incrementAndGet();
            return Mono.empty();
        }).block(TIMEOUT);

        assertThat(calls).hasValue(1);
        assertThat(exchange.getResponse().getStatusCode()).isNull();
    }

    @Test
    void unresolvedOrMissingNativeChannelPeerIsUnavailable() {
        var unresolved = InetSocketAddress.createUnresolved("example.invalid", 1234);
        assertThat(CliConnectionPeer.resolve(nativeCarrier(nativeRequest(unresolved)))).isNull();
        assertThat(CliConnectionPeer.resolve(nativeCarrier(nativeRequest(null)))).isNull();
        assertThat(CliConnectionPeer.resolve(nativeCarrier(new Object()))).isNull();
        var broken = mock(HttpServerRequest.class);
        doAnswer(invocation -> {
            throw new IllegalStateException("Connection unavailable");
        }).when(broken).withConnection(any());
        assertThat(CliConnectionPeer.resolve(nativeCarrier(broken))).isNull();
    }

    private static AbstractServerHttpRequest nativeCarrier(Object nativeRequest) {
        var carrier = mock(AbstractServerHttpRequest.class);
        when(carrier.getNativeRequest()).thenReturn(nativeRequest);
        return carrier;
    }

    private static HttpServerRequest nativeRequest(InetSocketAddress peer) {
        var request = mock(HttpServerRequest.class);
        var connection = mock(Connection.class);
        var channel = mock(Channel.class);
        when(connection.channel()).thenReturn(channel);
        when(channel.remoteAddress()).thenReturn(peer);
        doAnswer(invocation -> {
            Consumer<? super Connection> consumer = invocation.getArgument(0);
            consumer.accept(connection);
            return request;
        }).when(request).withConnection(any());
        return request;
    }

    private static final class Fixture {
        private final ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        private final ReactiveUserDetailsService owners = mock(ReactiveUserDetailsService.class);
        private final CliScopePolicy policy = new CliScopePolicy();
        private final CliAccessKeyService keys = new CliAccessKeyService(client, policy);
        private final String token;

        Fixture(Set<String> ipRanges) {
            var stored = new AtomicReference<CliAccessKey>();
            when(client.create(any(CliAccessKey.class))).thenAnswer(invocation -> {
                var key = invocation.getArgument(0, CliAccessKey.class);
                stored.set(key);
                return Mono.just(key);
            });
            when(client.fetch(eq(CliAccessKey.class), anyString())).thenAnswer(invocation ->
                Mono.justOrEmpty(stored.get()));
            when(client.update(any(CliAccessKey.class))).thenAnswer(invocation ->
                Mono.just(invocation.getArgument(0, CliAccessKey.class)));
            var created = keys.create("alice", new CliAccessKeyService.KeyInput("Peer test",
                Set.of("posts:read"), ipRanges, null, true)).block(TIMEOUT);
            token = created.token();
            when(owners.findByUsername("alice")).thenReturn(Mono.just(User.withUsername("alice")
                .password("unused").authorities("ROLE_editor").build()));
        }

        CliKeyAuthenticationFilter filter(CliConnectionPeer.Resolver resolver) {
            return new CliKeyAuthenticationFilter(keys, owners, policy, resolver);
        }

        MockServerWebExchange forwardedExchange(InetSocketAddress forwardedAddress) {
            var address = forwardedAddress.getAddress().getHostAddress();
            return MockServerWebExchange.from(MockServerHttpRequest.get(PATH)
                .remoteAddress(forwardedAddress)
                .header(HttpHeaders.AUTHORIZATION, "Bearer " + token)
                .header("Forwarded", "for=" + address + ";proto=https")
                .header("X-Forwarded-For", address)
                .header("X-Real-IP", address)
                .build());
        }
    }
}
