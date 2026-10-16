package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.Test;
import org.springframework.core.io.buffer.DataBufferUtils;
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
    private final ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
    private final CliPolicyWriteGuard guard = new CliPolicyWriteGuard(client);
    private final CliKeyAuthenticationToken key = new CliKeyAuthenticationToken(
        User.withUsername("owner").password("unused").roles("editor").build(),
        "key-id", "Test CLI", Set.of("policies:read", "policies:write"));

    @Test
    void cliKeyCannotCreatePolicyReferencingUnrelatedConfigMap() {
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(BASE)
            .contentType(MediaType.APPLICATION_JSON)
            .body("{\"spec\":{\"displayName\":\"S3\",\"templateName\":\"s3os\",\"configMapName\":\"private-oauth-config\"}}"));
        var called = new AtomicBoolean();
        guard.filter(exchange, next -> { called.set(true); return Mono.empty(); })
            .contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();
        assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        assertThat(called).isFalse();
    }

    @Test
    void normalCreateRetainsTheBodyForNativeValidationAndRbac() {
        var body = "{\"metadata\":{\"name\":\"my-s3\"},\"spec\":{\"displayName\":\"S3\",\"templateName\":\"s3os\"}}";
        var exchange = MockServerWebExchange.from(MockServerHttpRequest.post(BASE)
            .contentType(MediaType.APPLICATION_JSON).body(body));
        var received = new AtomicReference<String>();
        guard.filter(exchange, next -> DataBufferUtils.join(next.getRequest().getBody()).doOnNext(buffer -> {
            received.set(buffer.toString(StandardCharsets.UTF_8));
            DataBufferUtils.release(buffer);
        }).then()).contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();
        assertThat(received).hasValue(body);
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
            "{\"spec\":{\"displayName\":\"S3\",\"templateName\":\"s3os\",\"configMapName\":\"private-config\"}}",
            "{\"spec\":{\"displayName\":\"S3\",\"templateName\":\"local\",\"configMapName\":\"owned-config\"}}"
        }) {
            var exchange = MockServerWebExchange.from(MockServerHttpRequest.put(BASE + "/my-s3")
                .contentType(MediaType.APPLICATION_JSON).body(body));
            guard.filter(exchange, next -> Mono.error(new AssertionError("must not reach native handler")))
                .contextWrite(ReactiveSecurityContextHolder.withAuthentication(key)).block();
            assertThat(exchange.getResponse().getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN);
        }
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
