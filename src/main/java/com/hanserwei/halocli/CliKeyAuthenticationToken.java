package com.hanserwei.halocli;

import java.util.Set;
import org.springframework.security.authentication.AbstractAuthenticationToken;
import org.springframework.security.core.userdetails.UserDetails;

/** Key metadata is separate from the owner's current authorities. Never stores the raw key. */
public final class CliKeyAuthenticationToken extends AbstractAuthenticationToken {
    private final UserDetails owner;
    private final String keyName;
    private final String keyDisplayName;
    private final Set<String> scopes;

    CliKeyAuthenticationToken(UserDetails owner, String keyName, String keyDisplayName,
        Set<String> scopes) {
        super(owner.getAuthorities());
        this.owner = owner;
        this.keyName = keyName;
        this.keyDisplayName = keyDisplayName;
        this.scopes = Set.copyOf(scopes);
        super.setAuthenticated(true);
    }

    @Override
    public Object getCredentials() {
        return null;
    }

    @Override
    public UserDetails getPrincipal() {
        return owner;
    }

    @Override
    public String getName() {
        return owner.getUsername();
    }

    @Override
    public void setAuthenticated(boolean authenticated) {
        if (authenticated) {
            throw new IllegalArgumentException("Use verified owner details to authenticate a CLI key");
        }
        super.setAuthenticated(false);
    }

    public String keyName() {
        return keyName;
    }

    public String keyDisplayName() {
        return keyDisplayName;
    }

    public Set<String> scopes() {
        return scopes;
    }
}
