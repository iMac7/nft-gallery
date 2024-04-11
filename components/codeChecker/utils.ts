import { ZipEntry, unzip } from 'unzipit'
import config from './codechecker.config'
import { AssetMessage } from './types'
import { blake2AsHex } from '@polkadot/util-crypto'

type FileEntry = { path: string; content: string }

const cleanFileName = (path) => {
  const parts = path.split('/')
  return parts[parts.length - 1] // Returns only the file name
}

const createBlobUrlForEntry = async (entry, mimeType) => {
  const blob = await entry.blob()
  const typedBlob = new Blob([blob], { type: mimeType })
  return URL.createObjectURL(typedBlob)
}

const extractAssetAttributes = (
  element: HTMLScriptElement | HTMLLinkElement,
): {
  srcOrHref: string
  isExternal: boolean
  mimeType: string
  parent: 'head' | 'body'
} => {
  const srcOrHref = (element.getAttribute('src') ??
    element.getAttribute('href')) as string
  const isExternal = srcOrHref.startsWith('http')
  const mimeType =
    element.tagName.toLowerCase() === 'script' ? 'text/javascript' : 'text/css'
  const parent =
    element.parentNode?.nodeName.toLowerCase() === 'head' ? 'head' : 'body'

  return { srcOrHref, isExternal, mimeType, parent: parent }
}

// process and add a single asset to the assets array
const processAsset = async (element, entries, assets) => {
  const attributes = extractAssetAttributes(element)
  const assetType =
    element.tagName.toLowerCase() === 'script' ? 'script' : 'style'

  const asset: AssetMessage = {
    type: assetType,
    parent: attributes.parent,
    src: attributes.srcOrHref,
    originalSrc: attributes.srcOrHref,
  }

  if (attributes.isExternal) {
    assets.push(asset)
    return
  }

  const cleanName = cleanFileName(attributes.srcOrHref)
  const matchingEntryKey = Object.keys(entries).find((key) =>
    key.endsWith(cleanName),
  )

  if (matchingEntryKey) {
    const blobUrl = await createBlobUrlForEntry(
      entries[matchingEntryKey],
      attributes.mimeType,
    )
    asset.src = blobUrl
    assets.push(asset)
  }
}

const calculateCommonPrefix = (filePaths: string[]): string => {
  let commonPrefix = ''
  const indexPath = filePaths[0]
  if (indexPath) {
    const lastSlashIndex = indexPath.lastIndexOf('/')
    if (lastSlashIndex !== -1) {
      commonPrefix = indexPath.substring(0, lastSlashIndex + 1)
    }
  }
  return commonPrefix
}

const categorizeFiles = async (
  entries: { [key: string]: ZipEntry },
  commonPrefix: string,
): Promise<{ htmlFiles: FileEntry[]; jsFiles: FileEntry[] }> => {
  const htmlFiles: FileEntry[] = []
  const jsFiles: FileEntry[] = []

  for (const [path, file] of Object.entries(entries)) {
    const adjustedPath = path.replace(commonPrefix, '')
    const content = await file.text()

    if (path.endsWith('index.html')) {
      htmlFiles.push({ path: adjustedPath, content })
    } else if (path.endsWith(config.sketchFile)) {
      jsFiles.push({ path: adjustedPath, content })
    }
  }

  return { htmlFiles, jsFiles }
}

const loadImageOntoCanvas = (
  base64Str: string,
): Promise<CanvasRenderingContext2D> =>
  new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = img.width
      canvas.height = img.height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        return reject(new Error('Failed to get canvas context'))
      }
      ctx.drawImage(img, 0, 0)
      resolve(ctx)
    }
    img.onerror = reject
    img.src = base64Str
  })

// exported functions

export const postAssetsToSandbox = (message: Array<AssetMessage>) => {
  const iframe = document.getElementById(config.iframeId) as HTMLIFrameElement
  if (iframe?.contentWindow) {
    iframe.contentWindow.postMessage(
      { type: 'assets', assets: JSON.parse(JSON.stringify(message)) },
      window.location.origin,
    )
  }
}

export const generateRandomHash = () => {
  const randomValue = window.crypto
    .getRandomValues(new Uint8Array(20))
    .toString()
  return blake2AsHex(randomValue, 256, null, true)
}

export const extractAssetsFromZip = async (
  zip: File,
): Promise<{
  indexFile: FileEntry
  sketchFile: FileEntry
  entries: { [key: string]: ZipEntry }
}> => {
  const { entries } = await unzip(zip)
  const filePaths = Object.keys(entries)

  const commonPrefix = calculateCommonPrefix(filePaths)

  const { htmlFiles, jsFiles } = await categorizeFiles(entries, commonPrefix)

  return {
    indexFile: htmlFiles[0],
    sketchFile: jsFiles[0],
    entries,
  }
}

export const createSandboxAssets = async (
  indexFile: FileEntry,
  entries: { [key: string]: ZipEntry },
) => {
  const assets: Array<AssetMessage> = []
  const htmlContent = indexFile.content
  const parser = new DOMParser()
  const doc = parser.parseFromString(htmlContent, 'text/html')

  const assetElements = Array.from(
    doc.querySelectorAll('script[src], link[rel="stylesheet"][href]'),
  )

  for (const element of assetElements) {
    await processAsset(element, entries, assets)
  }
  return assets
}

export const hashImage = async (base64Str: string): Promise<string> => {
  const ctx = await loadImageOntoCanvas(base64Str)
  const { canvas } = ctx
  const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height)
  return blake2AsHex(imgData.data as unknown as Uint8Array)
}
