package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import org.springframework.test.web.reactive.server.WebTestClient;

class CliDownloadEndpointTest {

    private final CliDownloadEndpoint endpoint = new CliDownloadEndpoint();

    @Test
    void shouldExposeBundledCli() {
        var client = WebTestClient.bindToRouterFunction(endpoint.endpoint())
            .configureClient()
            .codecs(configurer -> configurer.defaultCodecs().maxInMemorySize(1024 * 1024))
            .build();

        client.get()
            .uri("/downloads/cli")
            .exchange()
            .expectStatus().isOk()
            .expectHeader().contentType("application/octet-stream")
            .expectHeader().valueEquals(
                "Content-Disposition", "attachment; filename=halo-cli.cjs")
            .expectBody()
            .consumeWith(result -> assertThat(result.getResponseBody()).isNotEmpty());
    }

    @Test
    void shouldUsePluginApiGroup() {
        assertThat(endpoint.groupVersion())
            .isEqualTo(new run.halo.app.extension.GroupVersion(
                "console.api.halo-cli.halo.run", "v1alpha1"));
    }
}
