package com.hanserwei.halocli;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Set;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.core.io.buffer.DataBufferLimitException;
import org.springframework.core.io.buffer.DataBufferUtils;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.attachment.Policy;
import run.halo.app.extension.ReactiveExtensionClient;
import run.halo.app.security.BeforeSecurityWebFilter;

/** A CLI key may manage policy values, but cannot use a Policy to point at arbitrary ConfigMaps. */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
public class CliPolicyWriteGuard implements BeforeSecurityWebFilter {
    private static final String POLICIES = "/apis/storage.halo.run/v1alpha1/policies";
    private static final ObjectMapper MAPPER = new ObjectMapper();
    private static final Set<String> SPEC_FIELDS = Set.of("displayName", "templateName", "configMapName");
    private final ReactiveExtensionClient client;

    CliPolicyWriteGuard(ReactiveExtensionClient client) {
        this.client = client;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        var path = exchange.getRequest().getURI().getRawPath();
        var create = HttpMethod.POST.equals(exchange.getRequest().getMethod()) && POLICIES.equals(path);
        var update = HttpMethod.PUT.equals(exchange.getRequest().getMethod())
            && path.startsWith(POLICIES + "/") && !path.substring(POLICIES.length() + 1).contains("/");
        if (!create && !update) {
            return chain.filter(exchange);
        }
        return ReactiveSecurityContextHolder.getContext()
            .map(context -> context.getAuthentication() instanceof CliKeyAuthenticationToken)
            .defaultIfEmpty(false)
            .flatMap(isCli -> {
                if (!isCli) return chain.filter(exchange);
                return DataBufferUtils.join(exchange.getRequest().getBody(), 256 * 1024)
                    .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST)))
                    .map(buffer -> {
                        try {
                            var bytes = new byte[buffer.readableByteCount()];
                            buffer.read(bytes);
                            return bytes;
                        } finally {
                            DataBufferUtils.release(buffer);
                        }
                    })
                    .flatMap(bytes -> validate(bytes, create ? null : path.substring(POLICIES.length() + 1))
                        .thenReturn(bytes))
                    .map(bytes -> {
                        var request = new ServerHttpRequestDecorator(exchange.getRequest()) {
                            @Override
                            public Flux<org.springframework.core.io.buffer.DataBuffer> getBody() {
                                return Flux.defer(() -> Flux.just(exchange.getResponse().bufferFactory().wrap(bytes)));
                            }
                        };
                        return exchange.mutate().request(request).build();
                    })
                    // Handle only this guard's errors; preserve errors raised by native handlers.
                    .map(downstream -> new Result(downstream, null))
                    .onErrorResume(ResponseStatusException.class,
                        error -> Mono.just(new Result(null, HttpStatus.valueOf(error.getStatusCode().value()))))
                    .onErrorResume(DataBufferLimitException.class,
                        error -> Mono.just(new Result(null, HttpStatus.PAYLOAD_TOO_LARGE)))
                    .flatMap(result -> {
                        if (result.status() == null) return chain.filter(result.exchange());
                        exchange.getResponse().setStatusCode(result.status());
                        exchange.getResponse().getHeaders().setCacheControl("no-store");
                        return exchange.getResponse().setComplete();
                    });
            });
    }

    private Mono<Void> validate(byte[] bytes, String name) {
        return Mono.defer(() -> {
            final JsonNode body;
            try { body = MAPPER.readTree(bytes); }
            catch (Exception error) { return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST)); }
            if (body == null || !body.isObject()
                || !matchesText(body.path("apiVersion"), "storage.halo.run/v1alpha1")
                || !matchesText(body.path("kind"), "Policy")
                || !body.path("spec").isObject()) {
                return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
            }
            if (name != null && (!body.path("metadata").isObject()
                || !matchesText(body.path("metadata").path("name"), name))) {
                return Mono.error(new ResponseStatusException(HttpStatus.BAD_REQUEST));
            }
            var spec = body.path("spec");
            var fields = spec.fieldNames();
            while (fields.hasNext()) {
                if (!SPEC_FIELDS.contains(fields.next())) return forbidden();
            }
            if (name == null) {
                return spec.has("configMapName") && !spec.path("configMapName").asText("").isEmpty()
                    ? forbidden() : Mono.empty();
            }
            return client.fetch(Policy.class, name)
                .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND)))
                .flatMap(current -> {
                    var previous = current.getSpec();
                    if (previous == null
                        || !java.util.Objects.equals(previous.getTemplateName(), spec.path("templateName").asText(null))
                        || !java.util.Objects.equals(previous.getConfigMapName(), spec.path("configMapName").asText(null))) {
                        return forbidden();
                    }
                    return Mono.empty();
                });
        });
    }

    private static boolean matchesText(JsonNode node, String expected) {
        return node.isTextual() && !node.textValue().isBlank() && expected.equals(node.textValue());
    }

    private static Mono<Void> forbidden() {
        return Mono.error(new ResponseStatusException(HttpStatus.FORBIDDEN));
    }

    private record Result(ServerWebExchange exchange, HttpStatus status) {
    }
}
