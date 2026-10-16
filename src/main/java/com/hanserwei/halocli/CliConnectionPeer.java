package com.hanserwei.halocli;

import java.net.InetSocketAddress;
import java.net.SocketAddress;
import java.util.concurrent.atomic.AtomicReference;
import org.springframework.http.server.reactive.ServerHttpRequest;
import org.springframework.http.server.reactive.ServerHttpRequestDecorator;
import reactor.netty.http.server.HttpServerRequest;

/**
 * Resolves the directly connected transport peer, never a forwarded client address.
 *
 * <p>Halo's native forwarding support can rewrite ServerHttpRequest.getRemoteAddress() and
 * HttpServerRequest.remoteAddress(). Only the underlying connection channel is authoritative here.
 * Behind a reverse proxy this is the proxy address; unknown transports fail closed for IP rules.
 */
final class CliConnectionPeer {
    private CliConnectionPeer() {
    }

    static InetSocketAddress resolve(ServerHttpRequest request) {
        try {
            Object nativeRequest = ServerHttpRequestDecorator.getNativeRequest(request);
            if (!(nativeRequest instanceof HttpServerRequest nettyRequest)) {
                return null;
            }
            var peer = new AtomicReference<SocketAddress>();
            nettyRequest.withConnection(connection -> peer.set(connection.channel().remoteAddress()));
            if (peer.get() instanceof InetSocketAddress address && !address.isUnresolved()) {
                return address;
            }
        } catch (RuntimeException error) {
            // No fallback to request.remoteAddress(): forwarding headers may have rewritten it.
            return null;
        }
        return null;
    }

    @FunctionalInterface
    interface Resolver {
        InetSocketAddress resolve(ServerHttpRequest request);
    }
}
