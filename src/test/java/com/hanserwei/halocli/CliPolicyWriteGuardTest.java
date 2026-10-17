package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.mock.http.server.reactive.MockServerHttpRequest;
import org.springframework.mock.web.server.MockServerWebExchange;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.userdetails.User;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.attachment.Policy;
import run.halo.app.extension.ReactiveExtensionClient;

class CliPolicyWriteGuardTest {
    private static final String BASE = "/apis/storage.halo.run/v1alpha1/policies";
    private static final String POLICY_GVK = "\"apiVersion\":\"storage.halo.run/v1alpha1\",\"kind\":\"Policy\"";
    private final ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
    private final CliPolicyWriteGuard guard = new CliPolicyWriteGuard(client);
    private final CliKeyAuthenticationToken key = new CliKeyAuthenticationToken(
        User.withUsername("owner").password("unused").roles("editor").build(),
        "key-id", "Test CLI", Set.of("policies:read", "policies:write"));

    @Test
    void cliKeyCannotCreatePolicyReferencingUnrelatedConfigMap() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(BASE)
            .contentType(MediaType.APPLICATION_JSON)
            .body(policyBody("{\"displayName\":\"S3\",\"templateName\":\"s3os\",\"configMapName\":\"private-oauth-config\"}")));
        var called = new AtomicBoolean();
        guard.filter(exchange, next -> { called.set(true); return Mono.empty(); })
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(called).isFalse();
        verifyNoInteractions(client);
    }

    @Test
    void normalCreateRetainsTheBodyForNativeValidationAndRbac() {
        var body = policyBody("{\"displayName\":\"S3\",\"templateName\":\"s3os\"}");
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(BASE)
            .contentType(MediaType.APPLICATION_JSON).body(body));
        var received = new AtomicReference<String>();
        guard.filter(exchange, next -> DataBufferUtils.join(next.getRequest().getBody()).doOnNext(buffer -> {
            received.set(buffer.toString(StandardCharsets.UTF_8));
            DataBufferUtils.release(buffer);
        }).then()).contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();
        assertThat(received).hasValue(body);
        assertThat(exchange.getResponse().getStatusCode()).isNull();
        verifyNoInteractions(client);
    }

    @Test
    void cliKeyCannotRebindExistingPolicyOrChangeItsHandler() {
        var policy = new Policy();
        var spec = new Policy.PolicySpec();
        spec.setDisplayName("S3");
        spec.setTemplateName("s3os");
        spec.setConfigMapName("owned-config");
        policy.setSpec(spec);
        when(client.fetch(Policy.class, "my-s3")).thenReturn(Mono.just(policy));
        for (var body : new String[] {
            policyBody("{\"displayName\":\"S3\",\"templateName\":\"s3os\",\"configMapName\":\"private-config\"}"),
            policyBody("{\"displayName\":\"S3\",\"templateName\":\"local\",\"configMapName\":\"owned-config\"}")
        }) {
            var exchange = MockServerWebExchange.from(MockServerHttpRequest.put(BASE + "/my-s3")
                .contentType(MediaType.APPLICATION_JSON).body(body));
            guard.filter(exchange, next -> Mono.error(new AssertionError("must not reach native handler")))
                .contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();
            assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
    }

    @ParameterizedTest
    @MethodSource("writeMethods")
    void cliKeyCannotWriteConfigMapThroughPolicyEndpoint(HttpMethod method) {
        assertRejected(method, """
            {"apiVersion":"v1alpha1","kind":"ConfigMap","metadata":{"name":"gvk-check"},
             "spec":{},"data":{"k":"v"}}
            """);
    }

    @ParameterizedTest
    @MethodSource("invalidPolicyIdentities")
    void cliKeyCannotWritePolicyWithInvalidGvk(HttpMethod method, String body) {
        assertRejected(method, body);
    }

    static Stream<HttpMethod> writeMethods() {
        return Stream.of(HttpMethod.POST, HttpMethod.PUT);
    }

    static Stream<Arguments> invalidPolicyIdentities() {
        return Stream.of("apiVersion", "kind").flatMap(field -> Stream.of(
            null, "null", "123", "true", "{}", "[]", "\"\"", "\" \\t \"",
            "\"v1alpha1\"", "\"other.halo.run/v1alpha1\"", "\"storage.halo.run/v1beta1\"",
            "\"ConfigMap\"", "\"policy\"", "\" Policy\"", "\"Policy \"",
            "\" storage.halo.run/v1alpha1\"", "\"storage.halo.run/v1alpha1 \"")
            .flatMap(value -> {
                var otherField = "apiVersion".equals(field)
                    ? "\"kind\":\"Policy\"" : "\"apiVersion\":\"storage.halo.run/v1alpha1\"";
                var invalidField = value == null ? "" : ",\"" + field + "\":" + value;
                var body = "{" + otherField + invalidField
                    + ",\"metadata\":{\"name\":\"my-s3\"},\"spec\":{}}";
                return writeMethods().map(method -> Arguments.of(method, body));
            }));
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {
        "null", "123", "true", "\"my-s3\"", "[]", "{}",
        "{\"name\":null}", "{\"name\":123}", "{\"name\":true}",
        "{\"name\":{}}", "{\"name\":[]}", "{\"name\":\"\"}", "{\"name\":\" \\t \"}",
        "{\"name\":\"other-policy\"}", "{\"name\":\" my-s3\"}", "{\"name\":\"my-s3 \"}"
    })
    void cliKeyCannotUpdatePolicyWithoutMatchingTextualName(String metadata) {
        var metadataField = metadata == null ? "" : ",\"metadata\":" + metadata;
        assertRejected(HttpMethod.PUT, "{" + POLICY_GVK + metadataField + ",\"spec\":{}}");
    }

    @Test
    void normalUpdateRetainsTheBodyAndExistingPolicyBinding() {
        var policy = new Policy();
        var spec = new Policy.PolicySpec();
        spec.setDisplayName("S3");
        spec.setTemplateName("s3os");
        spec.setConfigMapName("owned-config");
        policy.setSpec(spec);
        when(client.fetch(Policy.class, "my-s3")).thenReturn(Mono.just(policy));
        var body = policyBody("{\"displayName\":\"Renamed S3\",\"templateName\":\"s3os\",\"configMapName\":\"owned-config\"}");
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.put(BASE + "/my-s3")
            .contentType(MediaType.APPLICATION_JSON).body(body));
        var received = new AtomicReference<String>();

        guard.filter(exchange, next -> DataBufferUtils.join(next.getRequest().getBody()).doOnNext(buffer -> {
            received.set(buffer.toString(StandardCharsets.UTF_8));
            DataBufferUtils.release(buffer);
        }).then()).contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();

        assertThat(received).hasValue(body);
        assertThat(exchange.getResponse().getStatusCode()).isNull();
        verify(client).fetch(Policy.class, "my-s3");
        verifyNoMoreInteractions(client);
    }

    private void assertRejected(HttpMethod method, String body) {
        var path = HttpMethod.POST.equals(method) ? BASE : BASE + "/my-s3";
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.method(method, path)
            .contentType(MediaType.APPLICATION_JSON).body(body));
        var called = new AtomicBoolean();

        guard.filter(exchange, next -> { called.set(true); return Mono.empty(); })
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();

        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(called).isFalse();
        verifyNoInteractions(client);
    }

    private static String policyBody(String spec) {
        return "{" + POLICY_GVK + ",\"metadata\":{\"name\":\"my-s3\"},\"spec\":" + spec + "}";
    }

    @Test
    void nativePatAndSessionRequestsRemainOnTheOriginalHaloPath() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(BASE)
            .contentType(MediaType.APPLICATION_JSON).body("{\"spec\":{\"configMapName\":\"existing-config\"}}"));
        var called = new AtomicBoolean();
        guard.filter(exchange, next -> { called.set(true); return Mono.empty(); }).block();
        assertThat(called).isTrue();
    }
}
