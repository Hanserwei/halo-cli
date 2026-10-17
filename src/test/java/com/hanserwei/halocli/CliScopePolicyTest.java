package com.hanserwei.halocli;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Arrays;
import java.util.List;
import java.util.Set;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

class CliScopePolicyTest {
    private static final String CONTENT = "/apis/content.halo.run/v1alpha1/";
    private static final String CONSOLE = "/apis/api.console.halo.run/v1alpha1/";
    private static final String STORAGE = "/apis/storage.halo.run/v1alpha1/";
    private static final String CORE = "/api/v1alpha1/";
    private static final List<String> METHODS = List.of("GET", "HEAD", "OPTIONS", "POST", "PUT",
        "PATCH", "DELETE", "TRACE", "CONNECT", "get", "PROPFIND");
    private final CliScopePolicy policy = new CliScopePolicy();

    // Independent contract fixtures: scope | base path | method:relative-path, ...
    // 'example' is one concrete resource name.
    private static Stream<Contract> contracts() {
        return Stream.concat("""
            posts:read|content|GET:posts/example
            posts:read|console|GET:posts,GET:posts/example/head-content
            posts:write|content|PUT:posts/example,DELETE:posts/example
            posts:write|console|POST:posts,PUT:posts/example,PUT:posts/example/publish,PUT:posts/example/unpublish,PUT:posts/example/recycle
            singlepages:read|content|GET:singlepages/example
            singlepages:read|console|GET:singlepages,GET:singlepages/example/head-content,GET:singlepages/example/snapshot,GET:singlepages/example/content
            singlepages:write|content|PUT:singlepages/example,DELETE:singlepages/example
            singlepages:write|console|POST:singlepages,PUT:singlepages/example,PUT:singlepages/example/publish,PUT:singlepages/example/revert-content,DELETE:singlepages/example/content
            categories:read|content|GET:categories,GET:categories/example
            categories:write|content|POST:categories,PUT:categories/example,DELETE:categories/example
            tags:read|content|GET:tags,GET:tags/example
            tags:write|content|POST:tags,PUT:tags/example,DELETE:tags/example
            comments:read|console|GET:comments
            comments:read|content|GET:comments/example
            comments:write|content|PATCH:comments/example,DELETE:comments/example
            replies:read|console|GET:replies
            replies:read|content|GET:replies/example
            replies:write|content|PATCH:replies/example,DELETE:replies/example
            replies:write|console|POST:comments/example/reply
            attachments:read|console|GET:attachments
            attachments:read|storage|GET:attachments/example
            attachments:write|storage|PATCH:attachments/example,DELETE:attachments/example
            attachments:write|console|POST:attachments/upload,POST:attachments/-/upload-from-url
            groups:read|storage|GET:groups,GET:groups/example
            policies:read|storage|GET:policies,GET:policies/example,GET:policytemplates,GET:policytemplates/example
            policies:write|storage|POST:policies,PUT:policies/example,DELETE:policies/example
            policies:read|storage-console|GET:policies/example/configs/default
            policies:write|storage-console|PUT:policies/example/configs/default
            policies:read|cli-storage|GET:policies/example/configs/default
            policies:write|cli-storage|PUT:policies/example/configs/default
            menus:read|core|GET:menus,GET:menus/example
            menus:write|core|POST:menus,PUT:menus/example
            menus:write|console|DELETE:menus/example
            menuitems:read|core|GET:menuitems,GET:menuitems/example
            menuitems:write|core|POST:menuitems,PUT:menuitems/example,DELETE:menuitems/example
            menuitems:read|console|GET:menuitems/-/tree
            menuitems:write|console|PUT:menuitems/example/position
            plugins:read|console|GET:plugins,GET:plugins/example/setting,GET:plugins/example/json-config
            plugins:read|plugin|GET:plugins/example
            plugins:write|console|PUT:plugins/example/json-config,PUT:plugins/example/plugin-state,PUT:plugins/example/reload,PUT:plugins/example/reset-config
            themes:read|console|GET:themes,GET:themes/-/activation,GET:themes/example/setting,GET:themes/example/json-config
            themes:read|theme|GET:themes/example
            themes:write|console|PUT:themes/example/activation,PUT:themes/example/reload,PUT:themes/example/json-config,PUT:themes/example/reset-config,PUT:themes/example/invalidate-cache
            settings:read|core|GET:settings/system,GET:settings/example
            settings:read|settings|GET:basic,GET:post,GET:seo,GET:user,GET:attachment,GET:comment,GET:routeRules,GET:codeInjection,GET:menu
            settings:write|settings|PUT:basic,PUT:post,PUT:seo,PUT:user,PUT:attachment,PUT:comment,PUT:routeRules,PUT:codeInjection,PUT:menu
            known-plugin-extensions:read|moments-console|GET:moments,GET:moments/example,GET:tags
            known-plugin-extensions:write|moments-console|POST:moments
            known-plugin-extensions:read|photos-console|GET:photos,GET:photos/tags
            known-plugin-extensions:write|photos-console|POST:photos/upload,DELETE:photos/example,DELETE:photos/tags,DELETE:photos/upload,DELETE:photogroups/example
            known-plugin-extensions:read|links-console|GET:links,GET:links/-/detail,GET:linkapplications,GET:linkapplications/example
            known-plugin-extensions:write|links-console|POST:links/-/sort,POST:linkgroups/-/sort,POST:linkapplications/example/approve,POST:linkapplications/example/reject,POST:linkapplications/example/verify,DELETE:linkgroups/example,DELETE:linkapplications/example
            known-plugin-extensions:read|equipment-console|GET:equipments
            known-plugin-extensions:write|equipment-console|DELETE:equipmentgroups/example
            notifiers:read|notification|GET:notifierDescriptors,GET:notifierDescriptors/example
            notifiers:read|console|GET:notifiers/example/sender-config
            notifiers:write|console|POST:notifiers/example/sender-config
            notifiers:test|notification-console|POST:notifiers/default-email-notifier/verify-connection
            auth-providers:read|console|GET:auth-providers
            auth-providers:read|auth|GET:authproviders/example
            auth-providers:write|console|PUT:auth-providers/example/enable,PUT:auth-providers/example/disable
            search:read|search|POST:indices/-/search
            mail-templates:read|mail|GET:mailtemplates,GET:mailtemplates/example,GET:system-properties,POST:mailtemplates/example/validate
            mail-templates:write|mail|PUT:mailtemplates/example,DELETE:mailtemplates/example
            mail-templates:send|mail|POST:mailtemplates/example/verify-send
            """.lines().flatMap(line -> {
                String[] columns = line.split("\\|");
                String base = switch (columns[1]) {
                    case "content" -> CONTENT;
                    case "console" -> CONSOLE;
                    case "storage" -> STORAGE;
                    case "core" -> CORE;
                    case "plugin" -> "/apis/plugin.halo.run/v1alpha1/";
                    case "theme" -> "/apis/theme.halo.run/v1alpha1/";
                    case "settings" -> "/apis/console.api.halo.run/v1alpha1/systemconfigs/";
                    case "search" -> "/apis/api.halo.run/v1alpha1/";
                    case "mail" -> "/apis/console.api.mail-template.halo.run/v1alpha1/";
                    case "storage-console" -> "/apis/console.api.storage.halo.run/v1alpha1/";
                    case "cli-storage" -> "/apis/console.api.halo-cli.halo.run/v1alpha1/";
                    case "moments-console" -> "/apis/console.api.moment.halo.run/v1alpha1/";
                    case "photos-console" -> "/apis/console.api.photo.halo.run/v1alpha1/";
                    case "links-console" -> "/apis/console.api.link.halo.run/v1alpha1/";
                    case "equipment-console" ->
                        "/apis/console.api.equipment.hanserwei.github.io/v1alpha1/";
                    case "notification" -> "/apis/notification.halo.run/v1alpha1/";
                    case "notification-console" ->
                        "/apis/console.api.notification.halo.run/v1alpha1/";
                    case "auth" -> "/apis/auth.halo.run/v1alpha1/";
                    default -> throw new IllegalArgumentException(columns[1]);
                };
                return Arrays.stream(columns[2].split(",")).map(pair -> {
                    String[] route = pair.split(":", 2);
                    return new Contract(columns[0], route[0], base + route[1]);
                });
            }), extensionContracts());
    }

    private static Stream<Contract> extensionContracts() {
        return Stream.of("core.halo.run/v1alpha1/linkgroups", "core.halo.run/v1alpha1/links",
            "core.halo.run/v1alpha1/linkapplications", "core.halo.run/v1alpha1/photogroups",
            "core.halo.run/v1alpha1/photos", "moment.halo.run/v1alpha1/moments",
            "bangumi.roozen.top/v1alpha1/bangumis",
            "equipment.hanserwei.github.io/v1alpha1/equipmentgroups",
            "equipment.hanserwei.github.io/v1alpha1/equipments").flatMap(resource -> {
                String path = "/apis/" + resource;
                return Stream.of(
                    new Contract("known-plugin-extensions:read", "GET", path),
                    new Contract("known-plugin-extensions:read", "GET", path + "/example"),
                    new Contract("known-plugin-extensions:write", "POST", path),
                    new Contract("known-plugin-extensions:write", "PUT", path + "/example"),
                    new Contract("known-plugin-extensions:write", "PATCH", path + "/example"),
                    new Contract("known-plugin-extensions:write", "DELETE", path + "/example"));
            });
    }

    @ParameterizedTest
    @MethodSource("contracts")
    void shouldAllowEachKnownCliRequestOnlyWithItsOwnScope(Contract contract) {
        assertThat(policy.requiredScope(contract.method(), contract.path()))
            .contains(contract.scope());
        policy.authorize(Set.of(contract.scope()), contract.method(), contract.path());
        for (String scope : policy.supportedScopes()) {
            assertThat(policy.isAllowed(Set.of(scope), contract.method(), contract.path()))
                .as("%s against %s", scope, contract).isEqualTo(scope.equals(contract.scope()));
        }
        assertForbidden(Set.of(), contract.method(), contract.path());
        assertForbidden(Set.of("*", "admin", "posts:*", "unknown:write"),
            contract.method(), contract.path());
    }

    @ParameterizedTest
    @MethodSource("contracts")
    void shouldRejectEveryUnlistedMethodAndAdditionalPathSegment(Contract contract) {
        var fixtures = contracts().toList();
        for (String method : METHODS) {
            boolean listed = fixtures.stream().anyMatch(other -> other.method().equals(method)
                && other.path().equals(contract.path()));
            assertThat(policy.isAllowed(policy.supportedScopes(), method, contract.path()))
                .as("%s %s", method, contract.path()).isEqualTo(listed);
            if (!listed) {
                assertForbidden(policy.supportedScopes(), method, contract.path());
            }
        }
        assertForbidden(policy.supportedScopes(), contract.method(),
            contract.path() + "/example/unknown");
        assertForbidden(policy.supportedScopes(), contract.method(), contract.path() + "/");
        assertForbidden(policy.supportedScopes(), contract.method(),
            contract.path().replace("v1alpha1", "v1beta1"));
        assertForbidden(policy.supportedScopes(), contract.method(),
            contract.path().replace("/v1alpha1/", "/v1alpha1//"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"%2f", "%2F", "%5c", "%252f", "%2e%2e", "%252e%252e",
        "%65xample", "%00", "%0d%0a", "%", "%GG", ".", "..", "a..b", "../example",
        "example/../example", "example/./example", "example//child", "example\\child",
        "example;param=value", "example?x=y", "example#fragment", " example", "example ",
        "例子", "exаmple", "example\n", "example\u0000", "-", "_example", ".example"})
    void shouldDenyDangerousOrNonCanonicalNames(String name) {
        for (String method : METHODS) {
            assertForbidden(policy.supportedScopes(), method, CONTENT + "posts/" + name);
            assertForbidden(policy.supportedScopes(), method,
                CONSOLE + "singlepages/" + name + "/head-content");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"example", "Post-123", "a_b", "a.b", "a", "0", "a-"})
    void shouldAcceptCanonicalResourceNames(String name) {
        policy.authorize(Set.of("posts:read"), "GET", CONTENT + "posts/" + name);
    }

    @ParameterizedTest
    @ValueSource(strings = {
        "/apis/console.api.halo.run/v1alpha1/systemconfigs",
        "/apis/console.api.halo.run/v1alpha1/systemconfigs/email",
        "/apis/console.api.halo.run/v1alpha1/systemconfigs/smtp",
        "/apis/console.api.halo.run/v1alpha1/systemconfigs/notification",
        "/apis/console.api.halo.run/v1alpha1/systemconfigs/security",
        "/apis/console.api.halo.run/v1alpha1/systemconfigs/unknown",
        "/apis/console.api.halo.run/v1alpha1/systemconfigs/appearance",
        "/apis/equipment.kunkunyu.com/v1alpha1/equipmentgroups/example",
        "/apis/equipment.kunkunyu.com/v1alpha1/equipments/example",
        "/api/v1alpha1/rolebindings/example",
        "/apis/halo-cli.halo.run/v1alpha1/cliaccesskeys/example",
        "/apis/core.halo.run/v1alpha1/unknown/example",
        "/apis/core.halo.run/v1alpha1/moments/example",
        "/apis/moment.halo.run/v1alpha1/photos/example",
        "/apis/core.halo.run/v1beta1/links/example",
        "/apis/api.halo.run/v1alpha1/indices/example/search",
        "/apis/api.console.halo.run/v1alpha1/plugins/example/upgrade",
        "/apis/api.console.halo.run/v1alpha1/plugins/example/reset-config/unknown",
        "/apis/api.console.halo.run/v1alpha1/themes/example/reset-config/unknown",
        "/apis/api.console.halo.run/v1alpha1/themes/example/invalidate-cache/unknown",
        "/apis/api.console.halo.run/v1alpha1/themes/-/install-from-uri",
        "/apis/console.api.mail-template.halo.run/v1alpha1/mailtemplates/example/restore",
        "/apis/console.api.mail-template.halo.run/v1alpha1/mailtemplates/example/verify",
        "/apis/api.mail-template.halo.run/v1alpha1/mailtemplates/example",
        "/apis/api.console.halo.run/v1alpha1/systemconfigs/email",
        "/api/v1alpha1/configmaps/credentials", "/api/v1alpha1/secrets/example",
        "/api/v1alpha1/users/admin", "/api/v1alpha1/roles/admin",
        "/apis/api.console.halo.run/v1alpha1/users/-",
        "/apis/api.console.halo.run/v1alpha1/plugins/install",
        "/apis/api.console.halo.run/v1alpha1/plugins/-/install-from-uri",
        "/apis/api.console.halo.run/v1alpha1/themes/install",
        "/apis/unknown.halo.run/v1alpha1/posts/example",
        "/apis/content.halo.run/v1alpha1/unknown/example",
        "/apis/content.halo.run/v1alpha1/posts/example/status",
        "/apis/storage.halo.run/v1alpha1/groups/example/unknown",
        "/apis/storage.halo.run/v1alpha1/policies/example/unknown",
        "/apis/console.api.storage.halo.run/v1alpha1/policies/example/configs/unknown",
        "/apis/console.api.notification.halo.run/v1alpha1/notifiers/example/verify-connection",
        "/apis/api.console.halo.run/v1alpha1/auth-providers/example/unknown",
        "/apis/api.console.halo.run/v1alpha1/menuitems/example/tree",
        "/apis/api.console.halo.run/v1alpha1/attachments/example/upload-from-url",
        "/apis/api.console.halo.run/v1alpha1/singlepages/example/unpublish",
        "/apis/content.halo.run/v1alpha1/posts", "/api/v1alpha1/menus/example/position",
        "https://halo.example/apis/content.halo.run/v1alpha1/posts/example",
        "//apis/content.halo.run/v1alpha1/posts/example", "", "/"
    })
    void shouldDenyExcludedResourcesEvenWithAllScopes(String path) {
        for (String method : METHODS) {
            assertForbidden(policy.supportedScopes(), method, path);
        }
    }

    @Test
    void shouldDenyNullInputsAndKeepScopeCatalogImmutable() {
        assertForbidden(null, "GET", CONTENT + "posts/example");
        assertForbidden(policy.supportedScopes(), null, CONTENT + "posts/example");
        assertForbidden(policy.supportedScopes(), "GET", null);
        assertThat(policy.supportedScopes()).containsExactlyInAnyOrder(
            "posts:read", "posts:write", "singlepages:read", "singlepages:write",
            "categories:read", "categories:write", "tags:read", "tags:write",
            "comments:read", "comments:write", "replies:read", "replies:write",
            "attachments:read", "attachments:write", "groups:read", "policies:read",
            "policies:write", "notifiers:read", "notifiers:write", "notifiers:test",
            "auth-providers:read", "auth-providers:write",
            "menus:read", "menus:write", "menuitems:read", "menuitems:write",
            "plugins:read", "plugins:write", "themes:read", "themes:write",
            "settings:read", "settings:write", "known-plugin-extensions:read",
            "known-plugin-extensions:write", "search:read", "mail-templates:read",
            "mail-templates:write", "mail-templates:send");
        assertThatThrownBy(() -> policy.supportedScopes().add("admin"))
            .isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void shouldRequireReplyWriteScopeForReplyCreation() {
        String path = CONSOLE + "comments/example/reply";
        assertForbidden(Set.of("comments:write", "comments:read", "replies:read"), "POST", path);
        policy.authorize(Set.of("replies:write"), "POST", path);
    }

    @Test
    void shouldExposeCompleteImmutableUiCatalog() {
        var catalog = policy.scopes();
        assertThat(catalog).extracting(CliScopePolicy.Scope::name)
            .containsExactlyElementsOf(policy.supportedScopes().stream().sorted().toList());
        catalog.forEach(scope -> {
            assertThat(scope.displayName()).isNotBlank();
            assertThat(scope.description()).isNotBlank();
        });
        assertThatThrownBy(catalog::clear).isInstanceOf(UnsupportedOperationException.class);
    }

    @Test
    void shouldValidateScopeSelectionsAndReturnAnImmutableSnapshot() {
        var selected = new java.util.HashSet<>(Set.of("posts:read", "posts:write"));
        var validated = policy.validateScopes(selected);
        selected.clear();
        assertThat(validated).containsExactlyInAnyOrder("posts:read", "posts:write");
        assertThatThrownBy(() -> validated.add("tags:read"))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> policy.validateScopes(null))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> policy.validateScopes(Set.of()))
            .isInstanceOf(IllegalArgumentException.class);
        for (String invalid : List.of("*", "admin", "posts:*", "groups:write", "unknown:read",
            "POSTS:read", " posts:read")) {
            assertThatThrownBy(() -> policy.validateScopes(Set.of("posts:read", invalid)))
                .isInstanceOf(IllegalArgumentException.class);
        }
        var withNull = new java.util.HashSet<String>();
        withNull.add(null);
        assertThatThrownBy(() -> policy.validateScopes(withNull))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @ParameterizedTest
    @MethodSource("contracts")
    void shouldPreserveExactPolicyThroughFilterInterface(Contract contract) {
        var method = org.springframework.http.HttpMethod.valueOf(contract.method());
        assertThat(policy.allows(method, contract.path(), Set.of(contract.scope()))).isTrue();
        assertThat(policy.allows(method, contract.path(), Set.of())).isFalse();
        assertThat(policy.allows(method, contract.path(), null)).isFalse();
        assertThat(policy.allows(null, contract.path(), policy.supportedScopes())).isFalse();
    }

    @Test
    void shouldAllowOnlyExactGetProbeWithoutScopeAfterAuthentication() {
        String probe = "/apis/console.api.halo-cli.halo.run/v1alpha1/auth/me";
        assertThat(policy.allows(org.springframework.http.HttpMethod.GET, probe, Set.of())).isTrue();
        assertThat(policy.allows(org.springframework.http.HttpMethod.GET, probe, null)).isTrue();
        policy.authorize(Set.of(), "GET", probe);
        assertThat(policy.requiredScope("GET", probe)).isEmpty();
        for (String method : METHODS) {
            if (!method.equals("GET")) {
                assertForbidden(policy.supportedScopes(), method, probe);
            }
        }
        for (String invalid : List.of(probe + "/", probe + "/extra", probe + "?x=y",
            probe.replace("/auth/", "//auth/"), probe.replace("/me", "/%6de"),
            probe.replace("v1alpha1", "v1beta1"), probe.replace("/auth/me", "/auth/../auth/me"))) {
            assertThat(policy.allows(org.springframework.http.HttpMethod.GET, invalid,
                policy.supportedScopes())).isFalse();
            assertForbidden(policy.supportedScopes(), "GET", invalid);
        }
    }

    @Test
    void shouldKeepMailReadWriteAndSendIndependent() {
        String base = "/apis/console.api.mail-template.halo.run/v1alpha1/mailtemplates/example";
        policy.authorize(Set.of("mail-templates:read"), "POST", base + "/validate");
        assertForbidden(Set.of("mail-templates:write", "mail-templates:send"),
            "POST", base + "/validate");
        policy.authorize(Set.of("mail-templates:send"), "POST", base + "/verify-send");
        assertForbidden(Set.of("mail-templates:read", "mail-templates:write"),
            "POST", base + "/verify-send");
        assertForbidden(Set.of("mail-templates:send"), "GET", base);
        assertForbidden(Set.of("mail-templates:send"), "PUT", base);
        assertForbidden(Set.of("mail-templates:read"), "DELETE", base);
    }

    @Test
    void shouldNotGrantCoreBusinessRoutesThroughPluginExtensionScopes() {
        var scopes = Set.of("known-plugin-extensions:read", "known-plugin-extensions:write");
        assertForbidden(scopes, "GET", CONTENT + "posts/example");
        assertForbidden(scopes, "PUT", CONSOLE + "plugins/example/plugin-state");
        assertForbidden(scopes, "PUT",
            "/apis/console.api.halo.run/v1alpha1/systemconfigs/menu");
    }

    private void assertForbidden(java.util.Collection<String> scopes, String method, String path) {
        assertThat(policy.isAllowed(scopes, method, path)).isFalse();
        assertThatThrownBy(() -> policy.authorize(scopes, method, path))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
    }

    private record Contract(String scope, String method, String path) {
    }
}
