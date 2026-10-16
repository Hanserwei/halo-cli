package com.hanserwei.halocli;

import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.Sort;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;
import reactor.core.publisher.Flux;
import reactor.core.publisher.Mono;
import run.halo.app.extension.ExtensionUtil;
import run.halo.app.extension.ListOptions;
import run.halo.app.extension.Metadata;
import run.halo.app.extension.ReactiveExtensionClient;

@Component
public class CliAccessKeyService {
    private static final SecureRandom RANDOM = new SecureRandom();
    private static final String PREFIX = "hcli_";
    private static final Logger log = LoggerFactory.getLogger(CliAccessKeyService.class);
    private final ReactiveExtensionClient client;
    private final CliScopePolicy scopePolicy;

    CliAccessKeyService(ReactiveExtensionClient client, CliScopePolicy scopePolicy) {
        this.client = client;
        this.scopePolicy = scopePolicy;
    }

    Flux<KeyView> list(String owner) {
        return client.listAll(CliAccessKey.class, new ListOptions(),
                Sort.by(Sort.Order.desc("metadata.creationTimestamp")))
            .filter(key -> !ExtensionUtil.isDeleted(key))
            .filter(key -> key.getSpec() != null && owner.equals(key.getSpec().getOwnerName()))
            .map(CliAccessKeyService::view);
    }

    Mono<CreatedKey> create(String owner, KeyInput input) {
        return Mono.defer(() -> {
            var spec = validated(input);
            if (owner == null || owner.isBlank()) {
                throw new IllegalArgumentException("Owner must be authenticated");
            }
            var name = UUID.randomUUID().toString();
            var token = token(name);
            spec.setOwnerName(owner);
            spec.setKeyHash(hash(token));
            spec.setKeyPrefix(PREFIX + name.substring(0, 8));
            spec.setEnabled(true);
            var key = new CliAccessKey();
            var metadata = new Metadata();
            metadata.setName(name);
            key.setMetadata(metadata);
            key.setSpec(spec);
            return client.create(key).map(created -> new CreatedKey(view(created), token));
        });
    }

    Mono<KeyView> update(String owner, String name, KeyInput input) {
        return Mono.defer(() -> {
            var values = validated(input);
            return owned(owner, name).flatMap(key -> {
                var spec = key.getSpec();
                spec.setDisplayName(values.getDisplayName());
                spec.setScopes(values.getScopes());
                spec.setAllowedIpRanges(values.getAllowedIpRanges());
                spec.setExpiresAt(values.getExpiresAt());
                if (input.enabled() != null) {
                    spec.setEnabled(input.enabled());
                }
                return client.update(key).map(CliAccessKeyService::view);
            });
        });
    }

    Mono<CreatedKey> rotate(String owner, String name) {
        return owned(owner, name).flatMap(key -> {
            var token = token(name);
            key.getSpec().setKeyHash(hash(token));
            key.getSpec().setLastUsedAt(null);
            return client.update(key).map(updated -> new CreatedKey(view(updated), token));
        });
    }

    Mono<Void> delete(String owner, String name) {
        // Disable first so a soft-deleted extension cannot remain usable during finalization.
        return owned(owner, name).flatMap(key -> {
            key.getSpec().setEnabled(false);
            return client.update(key);
        }).flatMap(client::delete).then();
    }

    Mono<VerifiedKey> authenticate(String rawToken, InetSocketAddress remoteAddress) {
        return Mono.defer(() -> {
            var name = parseName(rawToken);
            if (name == null) {
                return Mono.empty();
            }
            return client.fetch(CliAccessKey.class, name)
                .filter(CliAccessKeyService::active)
                .filter(key -> matches(rawToken, key.getSpec().getKeyHash()))
                .filter(key -> CliIpAllowlist.allows(key.getSpec().getAllowedIpRanges(), remoteAddress))
                .map(key -> new VerifiedKey(name, key.getSpec().getDisplayName(),
                    key.getSpec().getOwnerName(), Set.copyOf(key.getSpec().getScopes())));
        });
    }

    Mono<Void> recordUse(String name) {
        return client.fetch(CliAccessKey.class, name)
            .filter(CliAccessKeyService::active)
            .filter(key -> key.getSpec().getLastUsedAt() == null
                || key.getSpec().getLastUsedAt().plusSeconds(300).isBefore(Instant.now()))
            .flatMap(key -> {
                key.getSpec().setLastUsedAt(Instant.now());
                // Optimistic metadata versions prevent this audit write reverting a revocation.
                return client.update(key);
            }).then().onErrorResume(error -> {
                log.debug("Could not record last-used time for CLI key {}", name);
                return Mono.empty();
            });
    }

    private Mono<CliAccessKey> owned(String owner, String name) {
        return client.fetch(CliAccessKey.class, name)
            .filter(key -> !ExtensionUtil.isDeleted(key) && key.getSpec() != null)
            .filter(key -> owner != null && owner.equals(key.getSpec().getOwnerName()))
            .switchIfEmpty(Mono.error(new ResponseStatusException(HttpStatus.NOT_FOUND,
                "CLI key not found")));
    }

    private CliAccessKey.Spec validated(KeyInput input) {
        if (input == null || input.displayName() == null || input.displayName().isBlank()
            || input.displayName().trim().length() > 100) {
            throw new IllegalArgumentException("displayName must contain 1 to 100 characters");
        }
        if (input.expiresAt() != null && !input.expiresAt().isAfter(Instant.now())) {
            throw new IllegalArgumentException("expiresAt must be in the future");
        }
        var spec = new CliAccessKey.Spec();
        spec.setDisplayName(input.displayName().trim());
        spec.setScopes(scopePolicy.validateScopes(input.scopes()));
        spec.setAllowedIpRanges(CliIpAllowlist.normalize(input.allowedIpRanges()));
        spec.setExpiresAt(input.expiresAt());
        return spec;
    }

    private static boolean active(CliAccessKey key) {
        var spec = key.getSpec();
        return !ExtensionUtil.isDeleted(key) && spec != null && spec.isEnabled()
            && spec.getOwnerName() != null && !spec.getOwnerName().isBlank()
            && spec.getScopes() != null
            && (spec.getExpiresAt() == null || spec.getExpiresAt().isAfter(Instant.now()));
    }

    private static String token(String name) {
        var bytes = new byte[32];
        RANDOM.nextBytes(bytes);
        return PREFIX + name + "_" + Base64.getUrlEncoder().withoutPadding().encodeToString(bytes);
    }

    private static String parseName(String token) {
        if (token == null || !token.matches(
            "hcli_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_[A-Za-z0-9_-]{43}")) {
            return null;
        }
        return token.substring(PREFIX.length(), PREFIX.length() + 36);
    }

    // SHA-256 is suitable for uniformly random 256-bit secrets; no human password is accepted.
    private static String hash(String token) {
        try {
            return HexFormat.of().formatHex(MessageDigest.getInstance("SHA-256")
                .digest(token.getBytes(StandardCharsets.US_ASCII)));
        } catch (NoSuchAlgorithmException error) {
            throw new IllegalStateException("SHA-256 is unavailable", error);
        }
    }

    private static boolean matches(String token, String expected) {
        if (expected == null || !expected.matches("[0-9a-f]{64}")) {
            return false;
        }
        return MessageDigest.isEqual(HexFormat.of().parseHex(expected),
            HexFormat.of().parseHex(hash(token)));
    }

    static KeyView view(CliAccessKey key) {
        var spec = key.getSpec();
        return new KeyView(key.getMetadata().getName(), spec.getDisplayName(), spec.getKeyPrefix(),
            spec.getOwnerName(), Set.copyOf(spec.getScopes()), spec.isEnabled(),
            Set.copyOf(spec.getAllowedIpRanges()), spec.getExpiresAt(),
            key.getMetadata().getCreationTimestamp(), spec.getLastUsedAt());
    }

    public record KeyInput(String displayName, Set<String> scopes, Set<String> allowedIpRanges,
        Instant expiresAt, Boolean enabled) {
    }

    public record KeyView(String name, String displayName, String keyPrefix, String ownerName,
        Set<String> scopes, boolean enabled, Set<String> allowedIpRanges, Instant expiresAt,
        Instant createdAt, Instant lastUsedAt) {
    }

    public record CreatedKey(KeyView key, String token) {
    }

    record VerifiedKey(String name, String displayName, String ownerName, Set<String> scopes) {
    }
}
