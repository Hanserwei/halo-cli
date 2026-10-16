package com.hanserwei.halocli;

import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.net.UnknownHostException;
import java.util.LinkedHashSet;
import java.util.Set;

/** Numeric addresses only: never resolves a hostname or trusts forwarding headers. */
final class CliIpAllowlist {
    private CliIpAllowlist() {
    }

    static Set<String> normalize(Set<String> ranges) {
        var result = new LinkedHashSet<String>();
        if (ranges == null) {
            return result;
        }
        if (ranges.size() > 64) {
            throw new IllegalArgumentException("At most 64 IP ranges are allowed");
        }
        for (var range : ranges) {
            if (range == null || range.isBlank()) {
                throw new IllegalArgumentException("IP range must not be blank");
            }
            var value = range.trim();
            parseRange(value);
            result.add(value);
        }
        return result;
    }

    static boolean allows(Set<String> ranges, InetSocketAddress remote) {
        if (ranges == null || ranges.isEmpty()) {
            return true;
        }
        if (remote == null) {
            return false;
        }
        try {
            var address = remote.getAddress() == null
                ? numeric(remote.getHostString()) : remote.getAddress().getAddress();
            return ranges.stream().map(CliIpAllowlist::parseRange)
                .anyMatch(range -> range.matches(address));
        } catch (IllegalArgumentException error) {
            return false;
        }
    }

    private static Range parseRange(String value) {
        var parts = value.split("/", -1);
        if (parts.length > 2) {
            throw new IllegalArgumentException("Invalid CIDR");
        }
        var address = numeric(parts[0]);
        var bits = address.length * 8;
        if (parts.length == 2) {
            if (!parts[1].matches("[0-9]{1,3}")) {
                throw new IllegalArgumentException("Invalid CIDR mask");
            }
            bits = Integer.parseInt(parts[1]);
            if (bits > address.length * 8) {
                throw new IllegalArgumentException("Invalid CIDR mask");
            }
        }
        return new Range(address, bits);
    }

    private static byte[] numeric(String value) {
        try {
            if (value.contains(":")) {
                // Character restriction prevents DNS and rejects zone IDs and bracket syntax.
                if (!value.matches("[0-9a-fA-F:.]+")) {
                    throw new IllegalArgumentException("Invalid numeric IP address");
                }
                return InetAddress.getByName(value).getAddress();
            }
            var octets = value.split("\\.", -1);
            if (octets.length != 4) {
                throw new IllegalArgumentException("Invalid IPv4 address");
            }
            var bytes = new byte[4];
            for (int i = 0; i < 4; i++) {
                if (!octets[i].matches("0|[1-9][0-9]{0,2}")) {
                    throw new IllegalArgumentException("Invalid IPv4 octet");
                }
                var octet = Integer.parseInt(octets[i]);
                if (octet > 255) {
                    throw new IllegalArgumentException("Invalid IPv4 octet");
                }
                bytes[i] = (byte) octet;
            }
            return bytes;
        } catch (UnknownHostException error) {
            throw new IllegalArgumentException("Invalid numeric IP address", error);
        }
    }

    private record Range(byte[] address, int bits) {
        boolean matches(byte[] candidate) {
            if (candidate.length != address.length) {
                return false;
            }
            for (int bit = 0; bit < bits; bit++) {
                var mask = 1 << (7 - bit % 8);
                if ((address[bit / 8] & mask) != (candidate[bit / 8] & mask)) {
                    return false;
                }
            }
            return true;
        }
    }
}
