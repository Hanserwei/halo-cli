package com.hanserwei.halocli;

import java.util.ArrayList;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Optional;
import java.util.Set;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.server.ResponseStatusException;

/**
 * Exact method/raw-path allowlist for the built-in CLI commands.
 *
 * <p>Pass {@code request.getURI().getRawPath()} before decoding or normalization, with no query
 * string or context-path stripping. Percent escapes (including otherwise harmless escapes),
 * non-ASCII names, trailing/repeated slashes, matrix parameters and dot segments fail closed.
 * Names must start with an ASCII letter/digit, followed by ASCII letters/digits, '.', '_' or '-';
 * consecutive dots are rejected. The reserved name '-' is allowed only in literal routes.
 *
 * <p>Scopes are independent exact strings: write never implies read; there is no wildcard or
 * administrator scope. Commands that fetch before writing or poll deletion need both scopes.
 * Only named business settings and known extension resources are exposed. Installation/upgrade,
 * arbitrary extensions/API calls, credential settings and Halo user endpoints are excluded.
 * The CLI auth/me GET probe is allowed without a scope after access-key authentication.
 * This policy is an additional ceiling, not a replacement for Halo authentication/RBAC. Call
 * {@link #authorize} from the access-key filter before dispatch to enforce HTTP 403.
 */
@Component
public final class CliScopePolicy {
    private static final String CONTENT = "/apis/content.halo.run/v1alpha1/";
    private static final String STORAGE = "/apis/storage.halo.run/v1alpha1/";
    private static final String CONSOLE = "/apis/api.console.halo.run/v1alpha1/";
    private static final String CORE = "/api/v1alpha1/";
    private static final List<Rule> RULES = rules();
    private static final Set<String> SUPPORTED_SCOPES = scopeNames();
    private static final String AUTH_ME =
        "/apis/console.api.halo-cli.halo.run/v1alpha1/auth/me";

    /** All accepted scope strings; the returned set is immutable. */
    public Set<String> supportedScopes() {
        return SUPPORTED_SCOPES;
    }

    /** Immutable, deterministically ordered scope catalog for management UI clients. */
    public List<Scope> scopes() {
        return SUPPORTED_SCOPES.stream().sorted().map(name -> {
            String[] parts = name.split(":", 2);
            String operation = switch (parts[1]) {
                case "read" -> "读取";
                case "send" -> "发送验证邮件";
                default -> "写入";
            };
            return new Scope(name, parts[0] + "：" + operation,
                operation + " CLI 白名单中的 " + parts[0] + " 接口；各权限独立授予。");
        }).toList();
    }

    /** Validate a nonempty selection and detach it from the caller's mutable set. */
    public Set<String> validateScopes(Set<String> selectedScopes) {
        if (selectedScopes == null || selectedScopes.isEmpty()
            || selectedScopes.stream().anyMatch(scope -> scope == null
                || !SUPPORTED_SCOPES.contains(scope))) {
            throw new IllegalArgumentException("CLI scopes must be nonempty and known");
        }
        return Set.copyOf(selectedScopes);
    }

    /** Entry point for the authenticated access-key filter. */
    public boolean allows(HttpMethod method, String rawPath, Set<String> grantedScopes) {
        return method != null && isAllowed(grantedScopes, method.name(), rawPath);
    }

    public record Scope(String name, String displayName, String description) {
    }

    /** Resolve only an explicitly listed method/raw-path pair; unknown input has no scope. */
    public Optional<String> requiredScope(String method, String rawPath) {
        if (method == null || !safePath(rawPath)) {
            return Optional.empty();
        }
        return RULES.stream()
            .filter(rule -> rule.method().equals(method) && rule.matches(rawPath))
            .map(Rule::scope)
            .findFirst();
    }

    public boolean isAllowed(Collection<String> grantedScopes, String method, String rawPath) {
        if ("GET".equals(method) && AUTH_ME.equals(rawPath)) {
            return true;
        }
        return grantedScopes != null && requiredScope(method, rawPath)
            .filter(grantedScopes::contains).isPresent();
    }

    /** Deny missing scopes, unknown methods/routes and malformed paths with HTTP 403. */
    public void authorize(Collection<String> grantedScopes, String method, String rawPath) {
        if (!isAllowed(grantedScopes, method, rawPath)) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "CLI scope denied");
        }
    }

    private static List<Rule> rules() {
        var rules = new ArrayList<Rule>();
        // post.ts / page.ts: lists and content use Console; restore/delete use Content API.
        for (String resource : List.of("posts", "singlepages")) {
            add(rules, resource + ":read", "GET", CONTENT + resource + "/{name}",
                CONSOLE + resource, CONSOLE + resource + "/{name}/head-content");
            add(rules, resource + ":write", "POST", CONSOLE + resource);
            add(rules, resource + ":write", "PUT", CONTENT + resource + "/{name}",
                CONSOLE + resource + "/{name}", CONSOLE + resource + "/{name}/publish");
            add(rules, resource + ":write", "DELETE", CONTENT + resource + "/{name}");
        }
        add(rules, "posts:write", "PUT", CONSOLE + "posts/{name}/unpublish",
            CONSOLE + "posts/{name}/recycle");
        add(rules, "singlepages:read", "GET", CONSOLE + "singlepages/{name}/snapshot",
            CONSOLE + "singlepages/{name}/content");
        add(rules, "singlepages:write", "PUT", CONSOLE + "singlepages/{name}/revert-content");
        add(rules, "singlepages:write", "DELETE", CONSOLE + "singlepages/{name}/content");

        for (String resource : List.of("categories", "tags")) {
            add(rules, resource + ":read", "GET", CONTENT + resource,
                CONTENT + resource + "/{name}");
            add(rules, resource + ":write", "POST", CONTENT + resource);
            add(rules, resource + ":write", "PUT", CONTENT + resource + "/{name}");
            add(rules, resource + ":write", "DELETE", CONTENT + resource + "/{name}");
        }
        for (String resource : List.of("comments", "replies")) {
            add(rules, resource + ":read", "GET", CONSOLE + resource,
                CONTENT + resource + "/{name}");
            add(rules, resource + ":write", "PATCH", CONTENT + resource + "/{name}");
            add(rules, resource + ":write", "DELETE", CONTENT + resource + "/{name}");
        }
        // Creating a reply requires replies:write even though its parent path is comments.
        add(rules, "replies:write", "POST", CONSOLE + "comments/{name}/reply");
        add(rules, "attachments:read", "GET", CONSOLE + "attachments",
            STORAGE + "attachments/{name}");
        add(rules, "attachments:write", "POST", CONSOLE + "attachments/upload",
            CONSOLE + "attachments/-/upload-from-url");
        add(rules, "attachments:write", "PATCH", STORAGE + "attachments/{name}");
        add(rules, "attachments:write", "DELETE", STORAGE + "attachments/{name}");
        add(rules, "groups:read", "GET", STORAGE + "groups");
        add(rules, "policies:read", "GET", STORAGE + "policies");

        for (String resource : List.of("menus", "menuitems")) {
            add(rules, resource + ":read", "GET", CORE + resource,
                CORE + resource + "/{name}");
            add(rules, resource + ":write", "POST", CORE + resource);
            add(rules, resource + ":write", "PUT", CORE + resource + "/{name}");
        }
        add(rules, "menus:write", "DELETE", CONSOLE + "menus/{name}");
        add(rules, "menuitems:write", "DELETE", CORE + "menuitems/{name}");
        add(rules, "menuitems:read", "GET", CONSOLE + "menuitems/-/tree");
        add(rules, "menuitems:write", "PUT", CONSOLE + "menuitems/{name}/position");

        // plugin.ts / theme.ts: never allow extension writes or install/upgrade endpoints.
        for (String resource : List.of("plugins", "themes")) {
            String group = resource.equals("plugins") ? "plugin.halo.run" : "theme.halo.run";
            add(rules, resource + ":read", "GET", CONSOLE + resource,
                "/apis/" + group + "/v1alpha1/" + resource + "/{name}",
                CONSOLE + resource + "/{name}/setting",
                CONSOLE + resource + "/{name}/json-config");
            add(rules, resource + ":write", "PUT",
                CONSOLE + resource + "/{name}/json-config",
                CONSOLE + resource + "/{name}/reset-config",
                CONSOLE + resource + "/{name}/reload");
        }
        add(rules, "plugins:write", "PUT", CONSOLE + "plugins/{name}/plugin-state");
        add(rules, "themes:read", "GET", CONSOLE + "themes/-/activation");
        add(rules, "themes:write", "PUT", CONSOLE + "themes/{name}/activation");
        add(rules, "themes:write", "PUT", CONSOLE + "themes/{name}/invalidate-cache");

        // Only groups exposed by Halo's system Setting, plus the core menu preference.
        add(rules, "settings:read", "GET", CORE + "settings/system");
        for (String group : List.of("basic", "post", "seo", "user", "attachment", "comment",
            "routeRules", "codeInjection", "menu")) {
            String path = "/apis/console.api.halo.run/v1alpha1/systemconfigs/" + group;
            add(rules, "settings:read", "GET", path);
            add(rules, "settings:write", "PUT", path);
        }
        // extension.ts presets (also referenced by hao.ts); no arbitrary group/version/resource.
        for (String resource : List.of("core.halo.run/v1alpha1/linkgroups",
            "core.halo.run/v1alpha1/links", "core.halo.run/v1alpha1/linkapplications",
            "moment.halo.run/v1alpha1/moments", "core.halo.run/v1alpha1/photogroups",
            "core.halo.run/v1alpha1/photos", "bangumi.roozen.top/v1alpha1/bangumis",
            "equipment.hanserwei.github.io/v1alpha1/equipmentgroups",
            "equipment.hanserwei.github.io/v1alpha1/equipments")) {
            String path = "/apis/" + resource;
            add(rules, "known-plugin-extensions:read", "GET", path, path + "/{name}");
            add(rules, "known-plugin-extensions:write", "POST", path);
            add(rules, "known-plugin-extensions:write", "PUT", path + "/{name}");
            add(rules, "known-plugin-extensions:write", "PATCH", path + "/{name}");
            add(rules, "known-plugin-extensions:write", "DELETE", path + "/{name}");
        }
        // Storage values are accessed through the policy API, never arbitrary ConfigMaps.
        add(rules, "policies:read", "GET", STORAGE + "policies/{name}",
            STORAGE + "policytemplates", STORAGE + "policytemplates/{name}");
        add(rules, "settings:read", "GET", CORE + "settings/{name}");
        add(rules, "policies:write", "POST", STORAGE + "policies");
        add(rules, "policies:write", "PUT", STORAGE + "policies/{name}");
        add(rules, "policies:write", "DELETE", STORAGE + "policies/{name}");
        String policyConfigs = "/apis/console.api.storage.halo.run/v1alpha1/policies/{name}/configs/default";
        add(rules, "policies:read", "GET", policyConfigs);
        add(rules, "policies:write", "PUT", policyConfigs);
        add(rules, "groups:read", "GET", STORAGE + "groups/{name}");
        String moments = "/apis/console.api.moment.halo.run/v1alpha1/";
        add(rules, "known-plugin-extensions:read", "GET", moments + "moments",
            moments + "moments/{name}", moments + "tags");
        add(rules, "known-plugin-extensions:write", "POST", moments + "moments");
        String photos = "/apis/console.api.photo.halo.run/v1alpha1/";
        add(rules, "known-plugin-extensions:read", "GET", photos + "photos", photos + "photos/tags");
        add(rules, "known-plugin-extensions:write", "POST", photos + "photos/upload");
        add(rules, "known-plugin-extensions:write", "DELETE", photos + "photos/{name}",
            photos + "photogroups/{name}");
        String links = "/apis/console.api.link.halo.run/v1alpha1/";
        add(rules, "known-plugin-extensions:read", "GET", links + "links", links + "links/-/detail",
            links + "linkapplications", links + "linkapplications/{name}");
        add(rules, "known-plugin-extensions:write", "POST", links + "links/-/sort",
            links + "linkgroups/-/sort", links + "linkapplications/{name}/approve",
            links + "linkapplications/{name}/reject", links + "linkapplications/{name}/verify");
        add(rules, "known-plugin-extensions:write", "DELETE", links + "linkgroups/{name}",
            links + "linkapplications/{name}");
        String equipment = "/apis/console.api.equipment.hanserwei.github.io/v1alpha1/";
        add(rules, "known-plugin-extensions:read", "GET", equipment + "equipments");
        add(rules, "known-plugin-extensions:write", "DELETE", equipment + "equipmentgroups/{name}");
        add(rules, "notifiers:read", "GET", "/apis/notification.halo.run/v1alpha1/notifierDescriptors",
            "/apis/notification.halo.run/v1alpha1/notifierDescriptors/{name}",
            CONSOLE + "notifiers/{name}/sender-config");
        add(rules, "notifiers:write", "POST", CONSOLE + "notifiers/{name}/sender-config");
        add(rules, "notifiers:test", "POST",
            "/apis/console.api.notification.halo.run/v1alpha1/notifiers/default-email-notifier/verify-connection");
        add(rules, "auth-providers:read", "GET", CONSOLE + "auth-providers",
            "/apis/auth.halo.run/v1alpha1/authproviders/{name}");
        add(rules, "auth-providers:write", "PUT", CONSOLE + "auth-providers/{name}/enable",
            CONSOLE + "auth-providers/{name}/disable");
        add(rules, "search:read", "POST", "/apis/api.halo.run/v1alpha1/indices/-/search");

        String mail = "/apis/console.api.mail-template.halo.run/v1alpha1/";
        add(rules, "mail-templates:read", "GET", mail + "mailtemplates",
            mail + "mailtemplates/{name}", mail + "system-properties");
        add(rules, "mail-templates:read", "POST", mail + "mailtemplates/{name}/validate");
        add(rules, "mail-templates:write", "PUT", mail + "mailtemplates/{name}");
        add(rules, "mail-templates:write", "DELETE", mail + "mailtemplates/{name}");
        add(rules, "mail-templates:send", "POST", mail + "mailtemplates/{name}/verify-send");
        return List.copyOf(rules);
    }

    private static void add(List<Rule> rules, String scope, String method, String... paths) {
        for (String path : paths) {
            rules.add(new Rule(method, path, scope));
        }
    }

    private static Set<String> scopeNames() {
        var scopes = new LinkedHashSet<String>();
        RULES.forEach(rule -> scopes.add(rule.scope()));
        return Set.copyOf(scopes);
    }

    private static boolean safePath(String path) {
        if (path == null || !path.startsWith("/") || path.endsWith("/")
            || path.contains("//") || path.contains("..")) {
            return false;
        }
        // No decoding or normalization: every accepted byte must already be canonical ASCII.
        for (int i = 0; i < path.length(); i++) {
            char ch = path.charAt(i);
            if (!asciiAlphanumeric(ch) && ch != '/' && ch != '.' && ch != '_' && ch != '-') {
                return false;
            }
        }
        return true;
    }

    private static boolean asciiAlphanumeric(char ch) {
        return ch >= 'a' && ch <= 'z' || ch >= 'A' && ch <= 'Z' || ch >= '0' && ch <= '9';
    }

    private record Rule(String method, String path, String scope) {
        private boolean matches(String candidate) {
            String[] expected = path.split("/", -1);
            String[] actual = candidate.split("/", -1);
            if (expected.length != actual.length) {
                return false;
            }
            for (int i = 0; i < expected.length; i++) {
                if (expected[i].equals("{name}")) {
                    if (actual[i].isEmpty() || !asciiAlphanumeric(actual[i].charAt(0))) {
                        return false;
                    }
                } else if (!expected[i].equals(actual[i])) {
                    return false;
                }
            }
            return true;
        }
    }
}
