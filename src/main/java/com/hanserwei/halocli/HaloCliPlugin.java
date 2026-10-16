package com.hanserwei.halocli;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import run.halo.app.extension.Scheme;
import run.halo.app.extension.SchemeManager;
import run.halo.app.plugin.BasePlugin;
import run.halo.app.plugin.PluginContext;

/**
 * <p>Plugin main class to manage the lifecycle of the plugin.</p>
 * <p>This class must be public and have a public constructor.</p>
 * <p>Only one main class extending {@link BasePlugin} is allowed per plugin.</p>
 *
 * @author hanserwei
 * @since 1.0.0
 */
@Component
public class HaloCliPlugin extends BasePlugin {
    private static final Logger log = LoggerFactory.getLogger(HaloCliPlugin.class);
    private final SchemeManager schemeManager;

    public HaloCliPlugin(PluginContext pluginContext, SchemeManager schemeManager) {
        super(pluginContext);
        this.schemeManager = schemeManager;
    }

    @Override
    public void start() {
        schemeManager.register(CliAccessKey.class);
        log.info("Halo CLI started");
    }

    @Override
    public void stop() {
        schemeManager.unregister(Scheme.buildFromType(CliAccessKey.class));
        log.info("Halo CLI stopped");
    }
}
