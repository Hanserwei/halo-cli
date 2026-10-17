package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoMoreInteractions;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.TimeUnit;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.dao.OptimisticLockingFailureException;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.reactive.AbstractReactiveTransactionManager;
import org.springframework.transaction.reactive.GenericReactiveTransaction;
import org.springframework.transaction.reactive.TransactionSynchronizationManager;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import reactor.core.publisher.Sinks;
import run.halo.app.core.extension.attachment.Policy;
import run.halo.app.extension.ConfigMap;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.MetadataOperator;
import run.halo.app.extension.ReactiveExtensionClient;

/**
 * Service unit tests with transaction-local writes and deterministic concurrent subscriptions.
 * The fake models CAS, commit and rollback; it does not exercise Halo's database or ExtensionStore.
 */
class CliStorageConfigurationServiceTest {
    private static final ObjectMapper JSON = new ObjectMapper();
    private static final Duration TIMEOUT = Duration.ofSeconds(5);
    private static final String POLICY = "my-s3";
    private static final String CONFIG_MAP = "my-s3-config";
    private static final String UNRELATED = "unrelated-config";
    private static final String WRITE_NONCE = "halo-cli.halo.run/storage-config-write";
    private final TransactionalStore store = new TransactionalStore();
    private final ReactiveExtensionClient client = store.client;
    private final CliStorageConfigurationService service =
        new CliStorageConfigurationService(client, store);

    @Test
    void staleSecretSnapshotUsesClientVersionAndPreservesNativeRotation() {
        var originalPolicy = policy(POLICY, 7L, CONFIG_MAP);
        store.policies.put(POLICY, copy(originalPolicy));
        store.configMaps.put(CONFIG_MAP, configuration(CONFIG_MAP, 11L, "old-secret"));
        var snapshot = service.get(POLICY).block(TIMEOUT);

        assertThat(snapshot).isNotNull();
        assertThat(snapshot.policyVersion()).isEqualTo(7L);
        assertThat(snapshot.configMapName()).isEqualTo(CONFIG_MAP);
        assertThat(snapshot.configMapVersion()).isEqualTo(11L);
        assertThat(snapshot.config()).isEqualTo(config("old-secret"));

        // A native writer rotates only the ConfigMap after the CLI's GET.
        var rotated = copy(store.configMaps.get(CONFIG_MAP));
        rotated.getMetadata().setVersion(12L);
        rotated.putDataItem("default", config("native-rotated-secret").toString());
        store.configMaps.put(CONFIG_MAP, copy(rotated));
        store.configMapReads.clear();
        clearInvocations(client);

        assertConflict(service.put(POLICY, snapshot));

        // The PUT fetched version 12, but must submit the client's version 11 to typed update.
        assertThat(store.configMapReads).singleElement().satisfies(read ->
            assertThat(read.getMetadata().getVersion()).isEqualTo(12L));
        var submitted = ArgumentCaptor.forClass(ConfigMap.class);
        verify(client).update(submitted.capture());
        assertThat(submitted.getValue().getMetadata().getName()).isEqualTo(CONFIG_MAP);
        assertThat(submitted.getValue().getMetadata().getVersion()).isEqualTo(11L);
        assertThat(submitted.getValue().getData().get("default"))
            .isEqualTo(snapshot.config().toString());
        assertThat(store.lockFailures).singleElement()
            .isInstanceOf(OptimisticLockingFailureException.class);
        assertThat(store.configMaps.get(CONFIG_MAP)).isEqualTo(rotated);
        assertThat(store.policies.get(POLICY)).isEqualTo(originalPolicy);
        assertThat(store.transactions).singleElement().satisfies(work -> {
            assertThat(work.events).containsExactly("update-policy", "update-config", "rollback");
            assertThat(work.rolledBackPolicyNames).containsExactly(POLICY);
            assertThat(work.policyUpdates).singleElement().satisfies(update ->
                assertPolicyFence(update, originalPolicy));
            assertThat(work.committed).isFalse();
            assertThat(work.rolledBack).isTrue();
            assertThat(work.policyWrites).isEmpty();
            assertThat(work.configMapWrites).isEmpty();
        });
        verify(client, times(1)).update(any(Policy.class));
        verify(client, never()).create(any(ConfigMap.class));
    }

    @ParameterizedTest(name = "{0}")
    @MethodSource("changedPolicies")
    void policyVersionOrReferenceChangeRejectsPutBeforeAnyConfigMapAccess(
        String change, Long version, String reference) {
        store.policies.put(POLICY, policy(POLICY, 7L, CONFIG_MAP));
        store.configMaps.put(CONFIG_MAP, configuration(CONFIG_MAP, 11L, "original-secret"));
        store.configMaps.put(UNRELATED, configuration(UNRELATED, 23L, "unrelated-secret"));
        var snapshot = service.get(POLICY).block(TIMEOUT);
        var changed = policy(POLICY, version, reference);
        store.policies.put(POLICY, copy(changed));
        var originalConfig = copy(store.configMaps.get(CONFIG_MAP));
        var unrelatedConfig = copy(store.configMaps.get(UNRELATED));
        clearInvocations(client);

        assertConflict(service.put(POLICY, snapshot));

        // No ConfigMap fetch, create, update or delete may even be requested on this path.
        verify(client).fetch(Policy.class, POLICY);
        verifyNoMoreInteractions(client);
        assertThat(store.configMaps).containsOnlyKeys(CONFIG_MAP, UNRELATED);
        assertThat(store.configMaps.get(CONFIG_MAP)).isEqualTo(originalConfig);
        assertThat(store.configMaps.get(UNRELATED)).isEqualTo(unrelatedConfig);
        assertThat(store.policies.get(POLICY)).isEqualTo(changed);
        assertThat(store.transactions).singleElement().satisfies(work -> {
            assertThat(work.events).containsExactly("rollback");
            assertThat(work.rolledBack).isTrue();
        });
    }

    static Stream<Arguments> changedPolicies() {
        return Stream.of(
            Arguments.of("Policy version advanced", 8L, CONFIG_MAP),
            Arguments.of("reference changed at the same version", 7L, UNRELATED),
            Arguments.of("reference removed at the same version", 7L, null));
    }

    @ParameterizedTest
    @NullAndEmptySource
    void unboundPolicyGetReturnsEmptyDefaultWithoutAccessingConfigMaps(String reference) {
        store.policies.put(POLICY, policy(POLICY, 7L, reference));

        var snapshot = service.get(POLICY).block(TIMEOUT);

        assertThat(snapshot).isNotNull();
        assertThat(snapshot.policyVersion()).isEqualTo(7L);
        assertThat(snapshot.configMapName()).isNull();
        assertThat(snapshot.configMapVersion()).isNull();
        assertThat(snapshot.config()).isEqualTo(JSON.createObjectNode());
        verify(client).fetch(Policy.class, POLICY);
        verifyNoMoreInteractions(client);
        assertThat(store.transactions).isEmpty();
    }

    @Test
    void firstPutPublishesConfigMapAndPolicyBindingInTheSameCommit() throws Exception {
        var originalPolicy = policy(POLICY, 7L, null);
        store.policies.put(POLICY, copy(originalPolicy));
        var unrelated = configuration(UNRELATED, 23L, "unrelated-secret");
        store.configMaps.put(UNRELATED, copy(unrelated));
        var snapshot = service.get(POLICY).block(TIMEOUT);
        store.holdPolicyUpdates = true;

        var pending = service.put(POLICY, withConfig(snapshot, config("first-secret"))).toFuture();

        assertThat(pending).isNotDone();
        assertThat(store.transactions).hasSize(1);
        var work = store.transactions.getFirst();
        assertThat(work.events).containsExactly("create-config", "update-policy");
        assertThat(work.createdNames).hasSize(1);
        var createdName = work.createdNames.getFirst();
        assertThat(createdName).startsWith("cli-policy-").isNotEqualTo(UNRELATED);
        assertThat(work.configMapWrites.get(createdName).getData())
            .containsExactlyEntriesOf(Map.of("default", config("first-secret").toString()));
        assertThat(work.policyUpdates).singleElement().satisfies(update -> {
            assertThat(update.getMetadata().getVersion()).isEqualTo(7L);
            assertThat(update.getSpec().getConfigMapName()).isEqualTo(createdName);
        });
        assertThat(store.policies.get(POLICY)).isEqualTo(originalPolicy);
        assertThat(store.configMaps).containsOnlyKeys(UNRELATED);

        releasePolicyCas(work);
        pending.get(TIMEOUT.toSeconds(), TimeUnit.SECONDS);

        var boundPolicy = copy(originalPolicy);
        boundPolicy.getMetadata().setVersion(8L);
        boundPolicy.getSpec().setConfigMapName(createdName);
        assertThat(store.policies.get(POLICY)).isEqualTo(boundPolicy);
        assertThat(store.configMaps).containsOnlyKeys(UNRELATED, createdName);
        assertThat(store.configMaps.get(UNRELATED)).isEqualTo(unrelated);
        assertThat(store.configMaps.get(createdName).getMetadata().getVersion()).isEqualTo(1L);
        assertThat(store.configMaps.get(createdName).getData())
            .containsExactlyEntriesOf(Map.of("default", config("first-secret").toString()));
        assertThat(work.events).containsExactly("create-config", "update-policy", "commit");
        assertThat(work.committed).isTrue();
        assertThat(work.rolledBack).isFalse();
        assertThat(work.configMapWrites).isEmpty();
        assertThat(work.policyWrites).isEmpty();
        assertThat(store.lockFailures).isEmpty();
        assertThat(service.get(POLICY).block(TIMEOUT)).isEqualTo(
            new CliStorageConfigurationService.Snapshot(8L, createdName, 1L, config("first-secret")));
    }

    @Test
    void failedFirstBindingCasRollsBackCreatedMapAndKeepsNativeBinding() {
        store.policies.put(POLICY, policy(POLICY, 7L, null));
        var nativeConfig = configuration(UNRELATED, 23L, "native-secret");
        store.configMaps.put(UNRELATED, copy(nativeConfig));
        var snapshot = service.get(POLICY).block(TIMEOUT);
        store.holdPolicyUpdates = true;
        var pending = service.put(POLICY, withConfig(snapshot, config("losing-secret"))).toFuture();
        assertThat(store.transactions).hasSize(1);
        var work = store.transactions.getFirst();
        assertThat(work.createdNames).hasSize(1);
        var losingName = work.createdNames.getFirst();
        assertThat(work.configMapWrites).containsOnlyKeys(losingName);
        assertThat(store.configMaps).doesNotContainKey(losingName);

        var nativePolicy = policy(POLICY, 8L, UNRELATED);
        store.policies.put(POLICY, copy(nativePolicy));
        releasePolicyCas(work);
        assertConflict(Mono.fromFuture(pending));

        assertThat(store.policies.get(POLICY)).isEqualTo(nativePolicy);
        assertThat(store.configMaps).containsOnlyKeys(UNRELATED);
        assertThat(store.configMaps.get(UNRELATED)).isEqualTo(nativeConfig);
        assertThat(work.events).containsExactly("create-config", "update-policy", "rollback");
        assertThat(work.rolledBackConfigMapNames).containsExactly(losingName);
        assertThat(work.configMapWrites).isEmpty();
        assertThat(work.committed).isFalse();
        assertThat(work.rolledBack).isTrue();
        assertThat(store.lockFailures).hasSize(1);
        verify(client, times(1)).create(any(ConfigMap.class));
        verify(client, times(1)).update(any(Policy.class));
        verify(client, never()).update(any(ConfigMap.class));
    }

    @ParameterizedTest(name = "transaction {0} wins")
    @ValueSource(ints = {0, 1})
    void concurrentFirstPutsReadSameOldPolicyAndOnlyOneBindingCommits(int winner)
        throws Exception {
        var originalPolicy = policy(POLICY, 7L, null);
        store.policies.put(POLICY, copy(originalPolicy));
        var unrelated = configuration(UNRELATED, 23L, "unrelated-secret");
        store.configMaps.put(UNRELATED, copy(unrelated));
        var snapshot = service.get(POLICY).block(TIMEOUT);
        store.policyReads.clear();
        clearInvocations(client);
        store.holdPolicyUpdates = true;
        var inputs = List.of(config("first-secret"), config("second-secret"));

        // Both subscriptions reach the CAS gate after reading and staging their own ConfigMap.
        // No threads, sleeps or scheduler ordering are needed to reproduce this interleaving.
        var results = List.of(
            service.put(POLICY, withConfig(snapshot, inputs.get(0))).toFuture(),
            service.put(POLICY, withConfig(snapshot, inputs.get(1))).toFuture());

        assertThat(results).allSatisfy(result -> assertThat(result).isNotDone());
        assertThat(store.transactions).hasSize(2);
        assertThat(store.policyReads).hasSize(2).allSatisfy(read ->
            assertThat(read).isEqualTo(originalPolicy));
        assertThat(store.policyReads.get(0)).isNotSameAs(store.policyReads.get(1));
        assertThat(store.transactions).allSatisfy(work -> {
            assertThat(work.events).containsExactly("create-config", "update-policy");
            assertThat(work.createdNames).hasSize(1);
            assertThat(work.configMapWrites).containsOnlyKeys(work.createdNames.getFirst());
            assertThat(work.policyUpdates).singleElement().satisfies(update ->
                assertThat(update.getMetadata().getVersion()).isEqualTo(7L));
        });
        assertThat(store.policies.get(POLICY)).isEqualTo(originalPolicy);
        assertThat(store.configMaps).containsOnlyKeys(UNRELATED);

        int loser = 1 - winner;
        var winningWork = store.transactions.get(winner);
        var losingWork = store.transactions.get(loser);
        var winningName = winningWork.createdNames.getFirst();
        var losingName = losingWork.createdNames.getFirst();
        assertThat(winningName).startsWith("cli-policy-").isNotEqualTo(losingName);
        assertThat(losingName).startsWith("cli-policy-");

        releasePolicyCas(winningWork);
        results.get(winner).get(TIMEOUT.toSeconds(), TimeUnit.SECONDS);
        assertThat(store.configMaps).containsOnlyKeys(UNRELATED, winningName);
        assertThat(losingWork.configMapWrites).containsOnlyKeys(losingName);
        assertThat(results.get(loser)).isNotDone();

        releasePolicyCas(losingWork);
        assertConflict(Mono.fromFuture(results.get(loser)));

        var boundPolicy = copy(originalPolicy);
        boundPolicy.getMetadata().setVersion(8L);
        boundPolicy.getSpec().setConfigMapName(winningName);
        assertThat(store.policies.get(POLICY)).isEqualTo(boundPolicy);
        assertThat(store.configMaps).containsOnlyKeys(UNRELATED, winningName);
        assertThat(store.configMaps.get(winningName).getData())
            .containsExactlyEntriesOf(Map.of("default", inputs.get(winner).toString()));
        assertThat(store.configMaps.get(UNRELATED)).isEqualTo(unrelated);
        assertThat(winningWork.events).containsExactly("create-config", "update-policy", "commit");
        assertThat(winningWork.committed).isTrue();
        assertThat(winningWork.rolledBack).isFalse();
        assertThat(losingWork.events).containsExactly("create-config", "update-policy", "rollback");
        assertThat(losingWork.rolledBackConfigMapNames).containsExactly(losingName);
        assertThat(losingWork.configMapWrites).isEmpty();
        assertThat(losingWork.committed).isFalse();
        assertThat(losingWork.rolledBack).isTrue();
        assertThat(store.lockFailures).hasSize(1);
        // A retry would read a newer Policy and could overwrite the winner's binding.
        verify(client, times(2)).fetch(Policy.class, POLICY);
        verify(client, times(2)).create(any(ConfigMap.class));
        verify(client, times(2)).update(any(Policy.class));
        verify(client, never()).update(any(ConfigMap.class));
        assertThat(store.transactions).hasSize(2);
    }

    @Test
    void policyReboundAfterValidationFailsTheFenceBeforeReadingAnyConfigMap() {
        store.policies.put(POLICY, policy(POLICY, 7L, CONFIG_MAP));
        var originalConfig = configuration(CONFIG_MAP, 11L, "old-secret");
        var replacementConfig = configuration(UNRELATED, 23L, "other-secret");
        store.configMaps.put(CONFIG_MAP, copy(originalConfig));
        store.configMaps.put(UNRELATED, copy(replacementConfig));
        var snapshot = service.get(POLICY).block(TIMEOUT);
        clearInvocations(client);
        store.holdPolicyUpdates = true;

        var pending = service.put(POLICY, withConfig(snapshot, config("stale-secret"))).toFuture();
        var work = store.transactions.getFirst();
        assertThat(pending).isNotDone();
        assertThat(work.events).containsExactly("update-policy");
        var rebound = policy(POLICY, 8L, UNRELATED);
        store.policies.put(POLICY, copy(rebound));
        releasePolicyCas(work);

        assertConflict(Mono.fromFuture(pending));
        assertThat(store.policies.get(POLICY)).isEqualTo(rebound);
        assertThat(store.configMaps.get(CONFIG_MAP)).isEqualTo(originalConfig);
        assertThat(store.configMaps.get(UNRELATED)).isEqualTo(replacementConfig);
        verify(client, never()).fetch(eq(ConfigMap.class), anyString());
        verify(client, never()).update(any(ConfigMap.class));
        assertThat(work.events).containsExactly("update-policy", "rollback");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void sharedReferenceRejectsGetAndPutIncludingDeletingOwners(boolean deletingOwner) {
        var originalPolicy = policy(POLICY, 7L, CONFIG_MAP);
        store.policies.put(POLICY, copy(originalPolicy));
        var other = policy("other-policy", 4L, CONFIG_MAP);
        if (deletingOwner) {
            other.getMetadata().setDeletionTimestamp(Instant.EPOCH);
        }
        store.policies.put("other-policy", copy(other));
        var originalConfig = configuration(CONFIG_MAP, 11L, "shared-secret");
        store.configMaps.put(CONFIG_MAP, copy(originalConfig));
        var snapshot = new CliStorageConfigurationService.Snapshot(
            7L, CONFIG_MAP, 11L, config("replacement-secret"));

        assertConflict(service.get(POLICY));
        verifyOnlyPolicyReads();
        clearInvocations(client);
        assertConflict(service.put(POLICY, snapshot));
        verifyOnlyPolicyReads();

        assertThat(store.configMapReads).isEmpty();
        assertThat(store.configMaps).containsOnlyKeys(CONFIG_MAP);
        assertThat(store.configMaps.get(CONFIG_MAP)).isEqualTo(originalConfig);
        assertThat(store.policies.get(POLICY)).isEqualTo(originalPolicy);
        assertThat(store.policies.get("other-policy")).isEqualTo(other);
        assertThat(store.transactions).singleElement().satisfies(work -> {
            assertThat(work.events).containsExactly("rollback");
            assertThat(work.committed).isFalse();
            assertThat(work.rolledBack).isTrue();
        });
    }

    @Test
    void getExposesOnlyDefaultAndPutPreservesEveryOtherGroup() {
        var originalPolicy = policy(POLICY, 7L, CONFIG_MAP);
        store.policies.put(POLICY, copy(originalPolicy));
        var originalConfig = configuration(CONFIG_MAP, 11L, "old-secret");
        // Other groups may contain opaque data; they must neither be parsed nor reserialized.
        originalConfig.putDataItem("thumbnails", " { \"width\" : 320 }\n");
        originalConfig.putDataItem("provider-private", "opaque-provider-data: keep verbatim");
        store.configMaps.put(CONFIG_MAP, copy(originalConfig));
        var unrelated = configuration(UNRELATED, 23L, "unrelated-secret");
        store.configMaps.put(UNRELATED, copy(unrelated));

        var snapshot = service.get(POLICY).block(TIMEOUT);

        assertThat(snapshot).isNotNull();
        assertThat(snapshot.config()).isEqualTo(config("old-secret"));
        var replacement = JSON.createObjectNode().put("secret", "new-secret").put("bucket", "new-bucket");
        service.put(POLICY, withConfig(snapshot, replacement)).block(TIMEOUT);

        var expectedData = new LinkedHashMap<>(originalConfig.getData());
        expectedData.put("default", replacement.toString());
        assertThat(store.configMaps.get(CONFIG_MAP).getData()).containsExactlyEntriesOf(expectedData);
        assertThat(store.configMaps.get(CONFIG_MAP).getMetadata().getVersion()).isEqualTo(12L);
        assertThat(store.configMaps.get(UNRELATED)).isEqualTo(unrelated);
        var submittedPolicy = store.transactions.getFirst().policyUpdates.getFirst();
        assertPolicyFence(submittedPolicy, originalPolicy);
        var expectedPolicy = copy(submittedPolicy);
        expectedPolicy.getMetadata().setVersion(8L);
        assertThat(store.policies.get(POLICY)).isEqualTo(expectedPolicy);
        var submitted = ArgumentCaptor.forClass(ConfigMap.class);
        verify(client).update(submitted.capture());
        assertThat(submitted.getValue().getMetadata().getVersion()).isEqualTo(11L);
        assertThat(submitted.getValue().getData()).containsExactlyEntriesOf(expectedData);
        verify(client, never()).create(any(ConfigMap.class));
        assertThat(store.transactions).singleElement().satisfies(work -> {
            assertThat(work.events).containsExactly("update-policy", "update-config", "commit");
            assertThat(work.committed).isTrue();
            assertThat(work.rolledBack).isFalse();
        });
        assertThat(service.get(POLICY).block(TIMEOUT)).isEqualTo(
            new CliStorageConfigurationService.Snapshot(8L, CONFIG_MAP, 12L, replacement));
    }

    @Test
    void everyExistingReferencePutChangesPolicyNonceAndPreservesOtherAnnotations() {
        var originalPolicy = policy(POLICY, 7L, CONFIG_MAP);
        originalPolicy.getMetadata().setAnnotations(new LinkedHashMap<>(
            Map.of("example.com/owner", "keep-owner", WRITE_NONCE, "previous-write")));
        store.policies.put(POLICY, copy(originalPolicy));
        store.configMaps.put(CONFIG_MAP, configuration(CONFIG_MAP, 11L, "old-secret"));
        var snapshot = service.get(POLICY).block(TIMEOUT);

        service.put(POLICY, withConfig(snapshot, config("new-secret"))).block(TIMEOUT);

        var firstUpdate = store.transactions.getFirst().policyUpdates.getFirst();
        var firstNonce = assertPolicyFence(firstUpdate, originalPolicy);
        var afterFirstWrite = copy(store.policies.get(POLICY));
        assertThat(afterFirstWrite.getMetadata().getVersion()).isEqualTo(8L);
        var freshSnapshot = service.get(POLICY).block(TIMEOUT);

        // An unchanged default group still requires a fresh, substantive Policy CAS.
        service.put(POLICY, freshSnapshot).block(TIMEOUT);

        assertThat(store.transactions).hasSize(2).allSatisfy(work -> {
            assertThat(work.committed).isTrue();
            assertThat(work.events).doesNotContain("policy-noop");
            assertThat(work.policyVersions).containsOnlyKeys(POLICY);
        });
        var secondUpdate = store.transactions.get(1).policyUpdates.getFirst();
        var secondNonce = assertPolicyFence(secondUpdate, afterFirstWrite);
        assertThat(secondNonce).isNotEqualTo(firstNonce);
        var expectedPolicy = copy(secondUpdate);
        expectedPolicy.getMetadata().setVersion(9L);
        assertThat(store.policies.get(POLICY)).isEqualTo(expectedPolicy);
        assertThat(store.configMaps.get(CONFIG_MAP).getMetadata().getVersion()).isEqualTo(12L);
        assertThat(store.transactions.get(1).events).contains("config-noop");
        verify(client, times(2)).update(any(Policy.class));
    }

    private static String assertPolicyFence(Policy submitted, Policy read) {
        assertThat(submitted).isNotEqualTo(read);
        var previous = read.getMetadata().getAnnotations();
        var nonce = submitted.getMetadata().getAnnotations().get(WRITE_NONCE);
        assertThat(nonce).isNotBlank().isNotEqualTo(previous == null ? null : previous.get(WRITE_NONCE));
        var annotations = previous == null
            ? new LinkedHashMap<String, String>() : new LinkedHashMap<>(previous);
        annotations.put(WRITE_NONCE, nonce);
        var expected = copy(read);
        expected.getMetadata().setAnnotations(annotations);
        assertThat(submitted).isEqualTo(expected);
        return nonce;
    }

    private void verifyOnlyPolicyReads() {
        verify(client).fetch(Policy.class, POLICY);
        verify(client).listAll(eq(Policy.class), any(ListOptions.class), eq(Sort.unsorted()));
        verifyNoMoreInteractions(client);
    }

    private static void assertConflict(Mono<?> operation) {
        assertThatThrownBy(() -> operation.block(TIMEOUT))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
    }

    private static void releasePolicyCas(Work work) {
        assertThat(work.allowPolicyCas.tryEmitEmpty()).isEqualTo(Sinks.EmitResult.OK);
    }

    private static CliStorageConfigurationService.Snapshot withConfig(
        CliStorageConfigurationService.Snapshot snapshot, JsonNode config) {
        return new CliStorageConfigurationService.Snapshot(snapshot.policyVersion(),
            snapshot.configMapName(), snapshot.configMapVersion(), config);
    }

    private static JsonNode config(String secret) {
        return JSON.createObjectNode().put("secret", secret).put("bucket", "attachments");
    }

    private static Policy policy(String name, Long version, String reference) {
        var policy = new Policy();
        var metadata = new Metadata();
        metadata.setName(name);
        metadata.setVersion(version);
        policy.setMetadata(metadata);
        var spec = new Policy.PolicySpec();
        spec.setDisplayName("S3 attachments");
        spec.setTemplateName("s3");
        spec.setConfigMapName(reference);
        policy.setSpec(spec);
        return policy;
    }

    private static ConfigMap configuration(String name, Long version, String secret) {
        var configMap = new ConfigMap();
        var metadata = new Metadata();
        metadata.setName(name);
        metadata.setVersion(version);
        configMap.setMetadata(metadata);
        configMap.putDataItem("default", config(secret).toString());
        return configMap;
    }

    private static Policy copy(Policy source) {
        var target = new Policy();
        target.setApiVersion(source.getApiVersion());
        target.setKind(source.getKind());
        target.setMetadata(copy(source.getMetadata()));
        if (source.getSpec() != null) {
            var spec = new Policy.PolicySpec();
            spec.setDisplayName(source.getSpec().getDisplayName());
            spec.setTemplateName(source.getSpec().getTemplateName());
            spec.setConfigMapName(source.getSpec().getConfigMapName());
            target.setSpec(spec);
        }
        return target;
    }

    private static ConfigMap copy(ConfigMap source) {
        var target = new ConfigMap();
        target.setApiVersion(source.getApiVersion());
        target.setKind(source.getKind());
        target.setMetadata(copy(source.getMetadata()));
        if (source.getData() != null) {
            target.setData(new LinkedHashMap<>(source.getData()));
        }
        return target;
    }

    private static Metadata copy(MetadataOperator source) {
        var target = new Metadata();
        target.setName(source.getName());
        target.setGenerateName(source.getGenerateName());
        target.setVersion(source.getVersion());
        target.setCreationTimestamp(source.getCreationTimestamp());
        target.setDeletionTimestamp(source.getDeletionTimestamp());
        if (source.getLabels() != null) {
            target.setLabels(new LinkedHashMap<>(source.getLabels()));
        }
        if (source.getAnnotations() != null) {
            target.setAnnotations(new LinkedHashMap<>(source.getAnnotations()));
        }
        if (source.getFinalizers() != null) {
            target.setFinalizers(new LinkedHashSet<>(source.getFinalizers()));
        }
        return target;
    }

    private static final class Work {
        private final Map<String, Policy> policyWrites = new LinkedHashMap<>();
        private final Map<String, ConfigMap> configMapWrites = new LinkedHashMap<>();
        private final Map<String, Long> policyVersions = new LinkedHashMap<>();
        private final Map<String, Long> configMapVersions = new LinkedHashMap<>();
        private final List<String> createdNames = new ArrayList<>();
        private final List<Policy> policyUpdates = new ArrayList<>();
        private final List<String> events = new ArrayList<>();
        private final List<String> rolledBackPolicyNames = new ArrayList<>();
        private final List<String> rolledBackConfigMapNames = new ArrayList<>();
        private final Sinks.Empty<Void> allowPolicyCas = Sinks.empty();
        private boolean committed;
        private boolean rolledBack;
    }

    /** Spring owns the transaction lifecycle; this resource only models storage behavior. */
    private static final class TransactionalStore extends AbstractReactiveTransactionManager {
        private final ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
        private final Map<String, Policy> policies = new LinkedHashMap<>();
        private final Map<String, ConfigMap> configMaps = new LinkedHashMap<>();
        private final List<Policy> policyReads = new ArrayList<>();
        private final List<ConfigMap> configMapReads = new ArrayList<>();
        private final List<Work> transactions = new ArrayList<>();
        private final List<OptimisticLockingFailureException> lockFailures = new ArrayList<>();
        private boolean holdPolicyUpdates;

        private TransactionalStore() {
            when(client.fetch(eq(Policy.class), anyString())).thenAnswer(invocation -> {
                String name = invocation.getArgument(1);
                return Mono.fromSupplier(() -> {
                    var value = policies.get(name);
                    if (value == null) {
                        return null;
                    }
                    policyReads.add(copy(value));
                    return copy(value);
                });
            });
            when(client.fetch(eq(ConfigMap.class), anyString())).thenAnswer(invocation -> {
                String name = invocation.getArgument(1);
                return Mono.fromSupplier(() -> {
                    var value = configMaps.get(name);
                    if (value == null) {
                        return null;
                    }
                    configMapReads.add(copy(value));
                    return copy(value);
                });
            });
            when(client.listAll(eq(Policy.class), any(ListOptions.class), any(Sort.class)))
                .thenAnswer(invocation -> Flux.defer(() ->
                    Flux.fromIterable(policies.values().stream().map(value -> copy(value)).toList())));
            when(client.create(any(ConfigMap.class))).thenAnswer(invocation ->
                create(copy(invocation.getArgument(0, ConfigMap.class))));
            when(client.update(any(Policy.class))).thenAnswer(invocation ->
                update(copy(invocation.getArgument(0, Policy.class))));
            when(client.update(any(ConfigMap.class))).thenAnswer(invocation ->
                update(copy(invocation.getArgument(0, ConfigMap.class))));
        }

        private Mono<Work> currentWork() {
            return TransactionSynchronizationManager.forCurrentTransaction().map(manager -> {
                assertThat(manager.isActualTransactionActive())
                    .as("each write must participate in the service transaction").isTrue();
                var work = (Work) manager.getResource(this);
                assertThat(work).as("transaction-local storage resource").isNotNull();
                return work;
            });
        }

        private Mono<ConfigMap> create(ConfigMap input) {
            return currentWork().map(work -> {
                var name = input.getMetadata().getName();
                assertThat(configMaps).doesNotContainKey(name);
                assertThat(work.configMapWrites).doesNotContainKey(name);
                assertThat(input.getMetadata().getVersion()).isNull();
                var staged = copy(input);
                staged.getMetadata().setVersion(1L);
                work.configMapWrites.put(name, staged);
                work.createdNames.add(name);
                work.events.add("create-config");
                return copy(staged);
            });
        }

        private Mono<Policy> update(Policy input) {
            return currentWork().flatMap(work -> {
                work.policyUpdates.add(copy(input));
                work.events.add("update-policy");
                var existing = policies.get(input.getMetadata().getName());
                // Halo 2.27 skips the database CAS when the complete JSON is identical.
                if (existing != null && JSON.valueToTree(input).equals(JSON.valueToTree(existing))) {
                    work.events.add("policy-noop");
                    return Mono.just(copy(existing));
                }
                Mono<Void> gate = holdPolicyUpdates ? work.allowPolicyCas.asMono() : Mono.empty();
                return gate.then(Mono.fromSupplier(() -> {
                    var name = input.getMetadata().getName();
                    var current = policies.get(name);
                    checkVersion("Policy", input.getMetadata().getVersion(),
                        current == null ? null : current.getMetadata().getVersion());
                    var staged = copy(input);
                    staged.getMetadata().setVersion(input.getMetadata().getVersion() + 1);
                    work.policyVersions.put(name, input.getMetadata().getVersion());
                    work.policyWrites.put(name, staged);
                    return copy(staged);
                }));
            });
        }

        private Mono<ConfigMap> update(ConfigMap input) {
            return currentWork().map(work -> {
                work.events.add("update-config");
                var name = input.getMetadata().getName();
                var current = configMaps.get(name);
                if (current != null && JSON.valueToTree(input).equals(JSON.valueToTree(current))) {
                    work.events.add("config-noop");
                    return copy(current);
                }
                checkVersion("ConfigMap", input.getMetadata().getVersion(),
                    current == null ? null : current.getMetadata().getVersion());
                var staged = copy(input);
                staged.getMetadata().setVersion(input.getMetadata().getVersion() + 1);
                work.configMapVersions.put(name, input.getMetadata().getVersion());
                work.configMapWrites.put(name, staged);
                return copy(staged);
            });
        }

        private void checkVersion(String kind, Long expected, Long actual) {
            if (expected == null || !Objects.equals(expected, actual)) {
                var error = new OptimisticLockingFailureException(kind + " version changed");
                lockFailures.add(error);
                throw error;
            }
        }

        @Override
        protected Object doGetTransaction(TransactionSynchronizationManager manager) {
            return new Work();
        }

        @Override
        protected Mono<Void> doBegin(TransactionSynchronizationManager manager, Object transaction,
            TransactionDefinition definition) {
            return Mono.fromRunnable(() -> {
                var work = (Work) transaction;
                manager.bindResource(this, work);
                transactions.add(work);
            });
        }

        @Override
        protected Mono<Void> doCommit(TransactionSynchronizationManager manager,
            GenericReactiveTransaction transaction) {
            return Mono.fromRunnable(() -> {
                var work = (Work) transaction.getTransaction();
                assertThat(manager.getResource(this)).isSameAs(work);
                // Validate every CAS before publishing either resource. A stale write cannot
                // leave a committed ConfigMap behind or expose an uncommitted Policy binding.
                synchronized (this) {
                    work.policyVersions.forEach((name, version) -> checkVersion("Policy", version,
                        policies.containsKey(name) ? policies.get(name).getMetadata().getVersion() : null));
                    work.configMapVersions.forEach((name, version) -> checkVersion("ConfigMap", version,
                        configMaps.containsKey(name) ? configMaps.get(name).getMetadata().getVersion() : null));
                    work.createdNames.forEach(name -> assertThat(configMaps).doesNotContainKey(name));
                    work.policyWrites.forEach((name, value) -> policies.put(name, copy(value)));
                    work.configMapWrites.forEach((name, value) -> configMaps.put(name, copy(value)));
                    work.events.add("commit");
                    work.committed = true;
                    work.policyWrites.clear();
                    work.configMapWrites.clear();
                }
            });
        }

        @Override
        protected Mono<Void> doRollback(TransactionSynchronizationManager manager,
            GenericReactiveTransaction transaction) {
            return Mono.fromRunnable(() -> {
                var work = (Work) transaction.getTransaction();
                assertThat(manager.getResource(this)).isSameAs(work);
                assertThat(work.committed).isFalse();
                work.rolledBackPolicyNames.addAll(work.policyWrites.keySet());
                work.rolledBackConfigMapNames.addAll(work.configMapWrites.keySet());
                work.policyWrites.clear();
                work.configMapWrites.clear();
                work.events.add("rollback");
                work.rolledBack = true;
            });
        }

        @Override
        protected Mono<Void> doCleanupAfterCompletion(TransactionSynchronizationManager manager,
            Object transaction) {
            return Mono.fromRunnable(() ->
                assertThat(manager.unbindResource(this)).isSameAs(transaction));
        }
    }
}
