package com.hanserwei.halocli;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.LinkedHashMap;
import java.util.Objects;
import java.util.UUID;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.transaction.ReactiveTransactionManager;
import org.springframework.transaction.reactive.TransactionalOperator;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Mono;
import run.halo.app.core.extension.attachment.Policy;
import run.halo.app.extension.ConfigMap;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;

/** Versioned access to the default group of a policy's existing configuration reference. */
@Component
public class CliStorageConfigurationService {
    private static final ObjectMapper JSON = new ObjectMapper();
    private final ReactiveExtensionClient client;
    private final TransactionalOperator transaction;

    public CliStorageConfigurationService(ReactiveExtensionClient client,
        ReactiveTransactionManager transactionManager) {
        this.client = client;
        this.transaction = TransactionalOperator.create(transactionManager);
    }

    Mono<Snapshot> get(String name) {
        return policy(name).flatMap(policy -> exclusive(policy).then(Mono.defer(() -> {
            var reference = reference(policy);
            if (reference == null) {
                return Mono.just(new Snapshot(policy.getMetadata().getVersion(), null, null,
                    JSON.createObjectNode()));
            }
            return configuration(reference).map(configMap -> new Snapshot(
                policy.getMetadata().getVersion(), reference, configMap.getMetadata().getVersion(),
                defaultGroup(configMap)));
        })));
    }

    Mono<Void> put(String name, Snapshot expected) {
        return Mono.defer(() -> {
            validate(expected);
            return policy(name).flatMap(policy -> {
                if (!Objects.equals(expected.policyVersion(), policy.getMetadata().getVersion())
                    || !Objects.equals(expected.configMapName(), reference(policy))) {
                    return Mono.error(conflict());
                }
                return exclusive(policy).then(Mono.defer(() -> {
                    // Halo 2.27 skips identical extension updates. A fresh annotation makes
                    // this a real Policy CAS that fences concurrent deletes/rebinds. Never
                    // replace client versions with newly fetched versions or retry this write.
                    policy.getMetadata().setVersion(expected.policyVersion());
                    if (expected.configMapName() == null) {
                        return create(policy, expected.config());
                    }
                    var annotations = policy.getMetadata().getAnnotations() == null
                        ? new LinkedHashMap<String, String>()
                        : new LinkedHashMap<>(policy.getMetadata().getAnnotations());
                    annotations.put("halo-cli.halo.run/storage-config-write", UUID.randomUUID().toString());
                    policy.getMetadata().setAnnotations(annotations);
                    return client.update(policy)
                        .then(Mono.defer(() -> configuration(expected.configMapName())))
                        .flatMap(configMap -> {
                            configMap.getMetadata().setVersion(expected.configMapVersion());
                            configMap.putDataItem("default", expected.config().toString());
                            return client.update(configMap);
                        }).then();
                }));
            });
        }).as(transaction::transactional)
            .onErrorMap(OptimisticLockingFailureException.class, error -> conflict());
    }

    private Mono<Void> create(Policy policy, JsonNode config) {
        var configMap = new ConfigMap();
        var metadata = new Metadata();
        // A fresh server-chosen name cannot reuse a caller-selected or unrelated ConfigMap.
        metadata.setName("cli-policy-" + UUID.randomUUID());
        configMap.setMetadata(metadata);
        configMap.putDataItem("default", config.toString());
        return client.create(configMap).flatMap(created -> {
            policy.getSpec().setConfigMapName(created.getMetadata().getName());
            return client.update(policy);
        }).then();
    }

    private Mono<Policy> policy(String name) {
        return client.fetch(Policy.class, name)
            .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                "Storage policy not found")))
            .map(policy -> {
                if (policy.getSpec() == null || policy.getMetadata().getVersion() == null
                    || policy.getMetadata().getDeletionTimestamp() != null) {
                    throw conflict();
                }
                reference(policy);
                return policy;
            });
    }

    private Mono<ConfigMap> configuration(String reference) {
        return client.fetch(ConfigMap.class, reference)
            .switchIfEmpty(Mono.error(conflict()))
            .map(configMap -> {
                if (configMap.getMetadata().getVersion() == null
                    || configMap.getMetadata().getDeletionTimestamp() != null) {
                    throw conflict();
                }
                return configMap;
            });
    }

    private Mono<Void> exclusive(Policy policy) {
        var reference = reference(policy);
        if (reference == null) {
            return Mono.empty();
        }
        // Include deleting policies: a still-present shared reference is not safe to update.
        return client.listAll(Policy.class, new ListOptions(), Sort.unsorted())
            .any(other -> !policy.getMetadata().getName().equals(other.getMetadata().getName())
                && other.getSpec() != null
                && reference.equals(other.getSpec().getConfigMapName()))
            .flatMap(shared -> shared ? Mono.error(new ResponseStatusException(HttpStatus.CONFLICT,
                "Shared storage configuration is not supported")) : Mono.empty());
    }

    private static String reference(Policy policy) {
        var reference = policy.getSpec().getConfigMapName();
        if (reference == null || reference.isEmpty()) {
            return null;
        }
        if (reference.isBlank()) {
            throw conflict();
        }
        return reference;
    }

    private static JsonNode defaultGroup(ConfigMap configMap) {
        var data = configMap.getData();
        if (data == null || !data.containsKey("default")) {
            return JSON.createObjectNode();
        }
        try {
            var value = JSON.readTree(data.get("default"));
            if (value == null || !value.isObject()) {
                throw conflict();
            }
            return value;
        } catch (IOException | IllegalArgumentException error) {
            // Parsing exceptions can embed credential values. Never retain or return their cause.
            throw conflict();
        }
    }

    private static void validate(Snapshot value) {
        if (value == null || value.policyVersion() == null || value.config() == null
            || !value.config().isObject()
            || (value.configMapName() == null) != (value.configMapVersion() == null)
            || value.configMapName() != null && value.configMapName().isBlank()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "Expected versions and a default configuration object are required");
        }
    }

    private static ResponseStatusException conflict() {
        return new ResponseStatusException(HttpStatus.CONFLICT,
            "Storage configuration changed; read it again before writing");
    }

    @JsonInclude(JsonInclude.Include.ALWAYS)
    public record Snapshot(Long policyVersion, String configMapName, Long configMapVersion,
        JsonNode config) {
    }
}
