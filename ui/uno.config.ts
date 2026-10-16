import { defineConfig, presetWind3, transformerCompileClass } from 'unocss'

export default defineConfig({
  presets: [presetWind3()],
  transformers: [transformerCompileClass()],
  theme: {
    colors: { primary: '#4CCBA0' },
    borderRadius: { base: '4px' },
  },
})
