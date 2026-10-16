package com.hanserwei.halocli;

import java.net.InetSocketAddress;
import java.util.List;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.security.authentication.AccountStatusUserDetailsChecker;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.core.context.ReactiveSecurityContextHolder;
import org.springframework.security.core.userdetails.ReactiveUserDetailsService;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ServerWebExchange;
import org.springframework.web.server.WebFilterChain;
import reactor.core.publisher.Mono;
import run.halo.app.security.BeforeSecurityWebFilter;

@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
public class CliKeyAuthenticationFilter implements BeforeSecurityWebFilter {
    private final CliAccessKeyService keys;
    private final ReactiveUserDetailsService owners;
    private final CliScopePolicy policy;
    private final CliConnectionPeer.Resolver peerResolver;
    private final AccountStatusUserDetailsChecker accountChecker = new AccountStatusUserDetailsChecker();

    @Autowired
    CliKeyAuthenticationFilter(CliAccessKeyService keys, ReactiveUserDetailsService owners,
        CliScopePolicy policy) {
        this(keys, owners, policy, CliConnectionPeer::resolve);
    }

    CliKeyAuthenticationFilter(CliAccessKeyService keys, ReactiveUserDetailsService owners,
        CliScopePolicy policy, CliConnectionPeer.Resolver peerResolver) {
        this.keys = keys;
        this.owners = owners;
        this.policy = policy;
        this.peerResolver = peerResolver;
    }

    @Override
    public Mono<Void> filter(ServerWebExchange exchange, WebFilterChain chain) {
        var headers = exchange.getRequest().getHeaders().getOrEmpty(HttpHeaders.AUTHORIZATION);
        if (!hasCliCredential(headers)) {
            return chain.filter(exchange);
        }
        if (headers.size() != 1 || !headers.getFirst().regionMatches(true, 0, "Bearer ", 0, 7)) {
            return reject(exchange, HttpStatus.UNAUTHORIZED);
        }
        var token = headers.getFirst().substring(7);
        // Catch only this authentication stage: errors from Halo handlers retain their own status.
        var peer = peerResolver.resolve(exchange.getRequest());
        return authenticate(token, peer)
            .map(authentication -> new Result(authentication, null))
            .onErrorResume(AuthenticationException.class,
                error -> Mono.just(new Result(null, HttpStatus.UNAUTHORIZED)))
            .flatMap(result -> {
                if (result.failure() != null) {
                    return reject(exchange, result.failure());
                }
                var authentication = result.authentication();
                if (!policy.allows(exchange.getRequest().getMethod(),
                    exchange.getRequest().getURI().getRawPath(), authentication.scopes())) {
                    return reject(exchange, HttpStatus.FORBIDDEN);
                }
                // The built-in Bearer filter would otherwise try to parse hcli_ as JWT.
                var downstream = exchange.mutate().request(request -> request.headers(
                    requestHeaders -> requestHeaders.remove(HttpHeaders.AUTHORIZATION))).build();
                return keys.recordUse(authentication.keyName())
                    .then(Mono.defer(() -> chain.filter(downstream)))
                    .contextWrite(ReactiveSecurityContextHolder.withAuthentication(authentication));
            });
    }

    private Mono<CliKeyAuthenticationToken> authenticate(String token, InetSocketAddress peer) {
        return keys.authenticate(token, peer)
            .switchIfEmpty(Mono.error(new BadCredentialsException("Invalid CLI key")))
            .flatMap(key -> owners.findByUsername(key.ownerName())
                .switchIfEmpty(Mono.error(new BadCredentialsException("Invalid CLI key owner")))
                .flatMap(owner -> {
                    accountChecker.check(owner);
                    // Owner lookup is asynchronous: reread key state before admitting this request.
                    return keys.authenticate(token, peer)
                        .filter(fresh -> owner.getUsername().equals(fresh.ownerName()))
                        .switchIfEmpty(Mono.error(new BadCredentialsException("Invalid CLI key")))
                        .map(fresh -> new CliKeyAuthenticationToken(owner, fresh.name(),
                            fresh.displayName(), fresh.scopes()));
                }));
    }

    private static boolean hasCliCredential(List<String> headers) {
        return headers.stream().anyMatch(value -> value != null
            && value.regionMatches(true, 0, "Bearer", 0, 6)
            && value.substring(6).stripLeading().startsWith("hcli_"));
    }

    private static Mono<Void> reject(ServerWebExchange exchange, HttpStatus status) {
        exchange.getResponse().setStatusCode(status);
        exchange.getResponse().getHeaders().setCacheControl("no-store");
        if (status == HttpStatus.UNAUTHORIZED) {
            exchange.getResponse().getHeaders().set(HttpHeaders.WWW_AUTHENTICATE, "Bearer");
        }
        return exchange.getResponse().setComplete();
    }

    private record Result(CliKeyAuthenticationToken authentication, HttpStatus failure) {
    }
}
