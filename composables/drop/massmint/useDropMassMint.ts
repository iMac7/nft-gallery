import {
  AllocatedNFT,
  DoResult,
  allocateCollection,
  allocateClaim as claimAllocation,
} from '@/services/fxart'

import { ImageDataPayload } from '../useGenerativeIframeData'
import { ToMintNft } from '@/components/collection/drop/types'
import { getFakeEmail } from '@/components/collection/drop/utils'
import useDropMassMintPreview from './useDropMassMintPreview'
import useDropMassMintUploader from './useDropMassMintUploader'
import { useCollectionEntity } from '../useGenerativeDropMint'

export type MassMintNFT = Omit<ToMintNft, 'priceUSD'> & {
  imageDataPayload?: ImageDataPayload
  metadata?: string
  hash: string
  sn?: number
  entropyRange: EntropyRange
  canRender: boolean
}

export default () => {
  const { accountId } = useAuth()

  useDropMassMintUploader()

  const { allPinned, payloads, pinMetadata, getPreviewItemsToMintedNfts } =
    useDropMassMintPreview()
  const { mintedAmountForCurrentUser } = useCollectionEntity()
  const dropStore = useDropStore()

  const {
    drop,
    amountToMint,
    previewItem,
    allocatedNFTs,
    toMintNFTs,
    mintingSession,
    loading,
  } = storeToRefs(dropStore)

  const raffleEmail = ref()

  const clearMassmint = () => {
    raffleEmail.value = undefined
    dropStore.resetMassmint()
  }

  const allocateRaffleMode = async (
    email: string,
    previewItem: GenerativePreviewItem,
  ) => {
    try {
      clearMassmint()
      loading.value = true
      raffleEmail.value = email
      toMintNFTs.value = getPreviewItemsToMintedNfts([previewItem])
    } catch (error) {
      console.log('[MASSMINT::RAFFLE] Failed', error)
      loading.value = false
    }
  }

  const generateMassPreview = (amount: number, minted: number) => {
    return Array(amount)
      .fill(null)
      .map((_, index) => {
        const entropyRange = getEntropyRange(minted + index)
        return generatePreviewItem({
          entropyRange,
          accountId: accountId.value,
          content: drop.value.content,
        })
      })
  }

  const allocateGenerated = async () => {
    try {
      clearMassmint()

      loading.value = true

      const [item] = getPreviewItemsToMintedNfts([
        previewItem.value as GenerativePreviewItem,
      ])

      const imageDataPayload = payloads.value.get(item.hash)

      const metadata = await pinMetadata({ ...item, imageDataPayload })

      await allocate([
        {
          ...item,
          metadata,
        },
      ])
    } catch (error) {
      loading.value = false
    }
  }

  const massGenerate = () => {
    try {
      clearMassmint()

      const single = amountToMint.value === 1

      if (single && !previewItem.value) {
        console.log(
          '[MASSMINT::GENERATE] Cant mint no preview item is provided',
        )
        return
      }

      loading.value = true

      const previewItems = single
        ? ([previewItem.value] as GenerativePreviewItem[])
        : generateMassPreview(
            amountToMint.value,
            mintedAmountForCurrentUser.value,
          )

      toMintNFTs.value = getPreviewItemsToMintedNfts(previewItems)
    } catch (error) {
      console.log('[MASSMINT::GENERATE] Failed', error)
      loading.value = false
    }
  }

  const allocate = async (mintNfts: MassMintNFT[]) => {
    try {
      loading.value = true

      const email = raffleEmail.value || getFakeEmail()
      const address = accountId.value

      const items = mintNfts.map(({ image, hash, metadata }) => ({
        image,
        hash,
        metadata,
      }))

      allocatedNFTs.value = await allocateItems({ items, email, address })

      // even thought the user might want x amount of items the worker can return a different amount
      const allocatedNFTsToMint = toMintNFTs.value.slice(
        0,
        allocatedNFTs.value.length,
      )

      toMintNFTs.value = allocatedNFTsToMint.map((toMint, index) => {
        const allocated = allocatedNFTs.value[index]
        return allocated
          ? { ...toMint, name: allocated.name, sn: Number(allocated.id) }
          : toMint
      })
    } catch (error) {
      console.log('[MASSMINT::ALLOCATE] Failed', error)
    } finally {
      loading.value = false
    }
  }

  const allocateItems = async ({
    items,
    email,
    address,
  }): Promise<AllocatedNFT[]> => {
    const results = [] as Array<AllocatedNFT>

    // @see https://github.com/kodadot/private-workers/pull/86#issuecomment-1975842570 for context
    for (const item of items) {
      const { result } = await allocateCollection(
        {
          email,
          address,
          image: item.image,
          hash: item.hash,
          metadata: item.metadata,
        },
        drop.value.id,
      )
      results.push(result)
    }

    return results
  }

  const submitMint = async (nft: MassMintNFT): Promise<DoResult> => {
    return new Promise((resolve, reject) => {
      try {
        claimAllocation(
          {
            sn: nft.sn,
            txHash: mintingSession.value.txHash,
            address: accountId.value,
          },
          drop.value.id,
        ).then(({ result }) => resolve(result))
      } catch (e) {
        reject(e)
      }
    })
  }

  watch(allPinned, async (pinned) => {
    if (pinned) {
      await allocate(toMintNFTs.value)
    }
  })

  onBeforeUnmount(clearMassmint)

  return {
    raffleEmail,
    massGenerate,
    submitMint,
    allocateRaffleMode,
    allocateGenerated,
    clearMassMint: clearMassmint,
  }
}
