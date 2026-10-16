package com.hanserwei.halocli;

import java.time.Instant;
import java.util.LinkedHashSet;
import java.util.Set;
import lombok.Data;
import lombok.EqualsAndHashCode;
import run.halo.app.extension.AbstractExtension;
import run.halo.app.extension.GVK;

/** Internal storage model. Management endpoints must return a projection, never this object. */
@Data
@EqualsAndHashCode(callSuper = true)
@GVK(group = "halo-cli.halo.run", version = "v1alpha1", kind = "CliAccessKey",
    plural = "cliaccesskeys", singular = "cliaccesskey")
public class CliAccessKey extends AbstractExtension {
    private Spec spec = new Spec();

    @Data
    public static class Spec {
        private String displayName;
        private String keyHash;
        private String keyPrefix;
        private String ownerName;
        private Set<String> scopes = new LinkedHashSet<>();
        private Set<String> allowedIpRanges = new LinkedHashSet<>();
        private boolean enabled = true;
        private Instant expiresAt;
        private Instant lastUsedAt;
    }
}
