package com.hanserwei.halocli;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import java.net.InetSocketAddress;
import java.time.Instant;
import java.util.Set;
import java.util.concurrent.atomic.AtomicReference;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ReactiveExtensionClient;

class CliAccessKeyServiceTest {
    private final ReactiveExtensionClient client = mock(ReactiveExtensionClient.class);
    private final AtomicReference<CliAccessKey> stored = new AtomicReference<>();
    private final CliAccessKeyService service = new CliAccessKeyService(client, new CliScopePolicy());

    @BeforeEach
    void storage() {
        when(client.create(any(CliAccessKey.class))).thenAnswer(invocation -> {
            var key = invocation.getArgument(0, CliAccessKey.class);
            stored.set(key);
            return Mono.just(key);
        });
        when(client.fetch(eq(CliAccessKey.class), anyString())).thenAnswer(invocation ->
            Mono.defer(() -> Mono.justOrEmpty(stored.get()).filter(key ->
                key.getMetadata().getName().equals(invocation.getArgument(1)))));
        when(client.update(any(CliAccessKey.class))).thenAnswer(invocation -> {
            var key = invocation.getArgument(0, CliAccessKey.class);
            stored.set(key);
            return Mono.just(key);
        });
    }

    private CliAccessKeyService.CreatedKey create() {
        return service.create("alice", input()).block();
    }

    private CliAccessKeyService.KeyInput input() {
        return new CliAccessKeyService.KeyInput("CI", Set.of("posts:read"), Set.of(), null, true);
    }

    @Test
    void storesOnlyHashAndReturnsSecretOnlyAtCreationOrRotation() throws Exception {
        var created = create();
        assertNotNull(created);
        assertTrue(created.token().matches("hcli_[0-9a-f-]{36}_[A-Za-z0-9_-]{43}"));
        assertFalse(stored.get().getSpec().getKeyHash().contains(created.token()));
        assertEquals(64, stored.get().getSpec().getKeyHash().length());
        var json = new ObjectMapper().findAndRegisterModules().writeValueAsString(created.key());
        assertFalse(json.contains("keyHash"));
        assertFalse(json.contains(stored.get().getSpec().getKeyHash()));
        assertFalse(json.contains(created.token()));
        var verified = service.authenticate(created.token(), null).block();
        assertNotNull(verified);
        assertEquals("alice", verified.ownerName());
        assertEquals(Set.of("posts:read"), verified.scopes());
    }

    @Test
    void disablingExpiryRevocationAndRotationTakeEffectWithoutCache() {
        var created = create();
        assertNotNull(service.authenticate(created.token(), null).block());
        stored.get().getSpec().setEnabled(false);
        assertNull(service.authenticate(created.token(), null).block());
        stored.get().getSpec().setEnabled(true);
        stored.get().getSpec().setExpiresAt(Instant.now().minusSeconds(1));
        assertNull(service.authenticate(created.token(), null).block());
        stored.get().getSpec().setExpiresAt(null);
        var rotated = service.rotate("alice", created.key().name()).block();
        assertNotNull(rotated);
        assertNotEquals(created.token(), rotated.token());
        assertNull(service.authenticate(created.token(), null).block());
        assertNotNull(service.authenticate(rotated.token(), null).block());
        stored.get().getMetadata().setDeletionTimestamp(Instant.now());
        assertNull(service.authenticate(rotated.token(), null).block());
        stored.set(null);
        assertNull(service.authenticate(rotated.token(), null).block());
    }

    @Test
    void revocationDisablesKeyBeforeSoftDeletion() {
        var created = create();
        when(client.delete(any(CliAccessKey.class))).thenAnswer(invocation -> {
            var key = invocation.getArgument(0, CliAccessKey.class);
            assertFalse(key.getSpec().isEnabled());
            key.getMetadata().setDeletionTimestamp(Instant.now());
            return Mono.just(key);
        });
        service.delete("alice", created.key().name()).block();
        assertNull(service.authenticate(created.token(), null).block());
        var order = inOrder(client);
        order.verify(client).update(any(CliAccessKey.class));
        order.verify(client).delete(any(CliAccessKey.class));
    }

    @Test
    void updatesAreObservedByTheNextAuthentication() {
        var created = create();
        var updated = service.update("alice", created.key().name(),
            new CliAccessKeyService.KeyInput("Renamed", Set.of("categories:read"),
                Set.of(), null, true)).block();
        assertEquals("Renamed", updated.displayName());
        assertEquals("alice", updated.ownerName());
        var verified = service.authenticate(created.token(), null).block();
        assertEquals(Set.of("categories:read"), verified.scopes());
        assertEquals("Renamed", verified.displayName());
    }

    @Test
    void ownerIsolationHidesForeignKeysForEveryMutationAndList() {
        var created = create();
        when(client.listAll(eq(CliAccessKey.class), any(), any())).thenReturn(Flux.just(stored.get()));
        assertTrue(service.list("bob").collectList().block().isEmpty());
        assertEquals(1, service.list("alice").collectList().block().size());
        assertNotFound(() -> service.update("bob", created.key().name(), input()).block());
        assertNotFound(() -> service.rotate("bob", created.key().name()).block());
        assertNotFound(() -> service.delete("bob", created.key().name()).block());
        verify(client, never()).update(any(CliAccessKey.class));
        verify(client, never()).delete(any(CliAccessKey.class));
    }

    @Test
    void malformedAndIncorrectCredentialsNeverAuthenticate() {
        var created = create();
        for (var token : new String[] {"", "hcli_", created.token() + "x",
            created.token().replaceFirst("hcli_", "pat_"),
            created.token().substring(0, created.token().length() - 1),
            created.token().substring(0, 42) + "!".repeat(43)}) {
            assertNull(service.authenticate(token, null).block());
        }
        var replacement = created.token().endsWith("A") ? "B" : "A";
        var wrong = created.token().substring(0, created.token().length() - 1) + replacement;
        assertNull(service.authenticate(wrong, null).block());
        stored.get().getSpec().setKeyHash("malformed");
        assertNull(service.authenticate(created.token(), null).block());
    }

    @Test
    void validatesScopesExpiryAndNumericIpRanges() {
        assertThrows(IllegalArgumentException.class, () -> service.create("alice",
            new CliAccessKeyService.KeyInput("CI", Set.of("*"), Set.of(), null, true)).block());
        assertThrows(IllegalArgumentException.class, () -> service.create("alice",
            new CliAccessKeyService.KeyInput("CI", Set.of("posts:read"), Set.of("example.com"),
                null, true)).block());
        assertThrows(IllegalArgumentException.class, () -> service.create("alice",
            new CliAccessKeyService.KeyInput("CI", Set.of("posts:read"), Set.of(),
                Instant.now().minusSeconds(1), true)).block());
        var created = service.create("alice", new CliAccessKeyService.KeyInput("CI",
            Set.of("posts:read"), Set.of("192.0.2.0/24"), null, true)).block();
        assertNotNull(created);
        assertNotNull(service.authenticate(created.token(), new InetSocketAddress("192.0.2.4", 5)).block());
        assertNull(service.authenticate(created.token(), new InetSocketAddress("198.51.100.4", 5)).block());
        assertNull(service.authenticate(created.token(), null).block());
    }

    private static void assertNotFound(Runnable action) {
        var error = assertThrows(ResponseStatusException.class, action::run);
        assertEquals(HttpStatus.NOT_FOUND, error.getStatusCode());
    }
}
