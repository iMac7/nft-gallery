<template>
  <iframe
    :id="config.iframeId"
    :key="count"
    title="render-preview"
    :class="[
      'sandbox-iframe w-full h-full sm:h-[440px] aspect-square border',
      customClass,
    ]"
    sandbox="allow-scripts allow-same-origin"
    :src="iframeSrc"
    @load="onIframeLoad">
  </iframe>
</template>

<script setup lang="ts">
import { postAssetsToSandbox } from './utils'
import config from './codechecker.config'
import { AssetMessage } from './types'

const props = defineProps<{
  hash: string
  assets: Array<AssetMessage>
  count: number
  customClass?: string
}>()

const emit = defineEmits(['update:count'])

const vCount = useVModel(props, 'count', emit)

const iframeSrc = computed(() => `/sandbox.html?hash=${props.hash}`)
watch(
  () => props.assets,
  () => {
    // force update iframe
    vCount.value++
  },
  { deep: true },
)

function onIframeLoad() {
  postAssetsToSandbox(props.assets)
}
</script>
