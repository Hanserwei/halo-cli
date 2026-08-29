package com.hanserwei.halocli;

import static org.springframework.http.HttpHeaders.CONTENT_DISPOSITION;
import static org.springframework.http.MediaType.APPLICATION_OCTET_STREAM;

import org.springframework.core.io.ClassPathResource;
import org.springframework.stereotype.Component;
import org.springframework.web.reactive.function.BodyInserters;
import org.springframework.web.reactive.function.server.RouterFunction;
import org.springframework.web.reactive.function.server.RouterFunctions;
import org.springframework.web.reactive.function.server.ServerResponse;
import run.halo.app.core.extension.endpoint.CustomEndpoint;
import run.halo.app.extension.GroupVersion;

@Component
public class CliDownloadEndpoint implements CustomEndpoint {

    static final String CLI_RESOURCE = "cli/halo-cli.cjs";

    @Override
    public RouterFunction<ServerResponse> endpoint() {
        return RouterFunctions.route()
            .GET("/downloads/cli", request -> download())
            .build();
    }

    private reactor.core.publisher.Mono<ServerResponse> download() {
        var resource = new ClassPathResource(CLI_RESOURCE);
        if (!resource.exists()) {
            return ServerResponse.notFound().build();
        }
        return ServerResponse.ok()
            .contentType(APPLICATION_OCTET_STREAM)
            .header(CONTENT_DISPOSITION, "attachment; filename=halo-cli.cjs")
            .body(BodyInserters.fromResource(resource));
    }

    @Override
    public GroupVersion groupVersion() {
        return new GroupVersion("console.api.halo-cli.halo.run", "v1alpha1");
    }
}
