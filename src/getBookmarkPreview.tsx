import {
  AssetRecordType,
  type TLAsset,
  type TLBookmarkAsset,
  getHashForString,
} from "tldraw";
import { API_URL } from "./config";

interface BookmarkPreviewResponse {
  description?: string;
  image?: string;
  favicon?: string;
  title?: string;
}

// How does our server handle bookmark unfurling?
export async function getBookmarkPreview({
  url,
}: {
  url: string;
}): Promise<TLAsset> {
  // we start with an empty asset record
  const asset: TLBookmarkAsset = {
    id: AssetRecordType.createId(getHashForString(url)),
    typeName: "asset",
    type: "bookmark",
    meta: {},
    props: {
      src: url,
      description: "",
      image: "",
      favicon: "",
      title: "",
    },
  };

  try {
    // try to fetch the preview data from the server
    const response = await fetch(
      `${API_URL}/api/unfurl?url=${encodeURIComponent(url)}`,
    );
    const data = (await response.json()) as BookmarkPreviewResponse;

    // fill in our asset with whatever info we found
    asset.props.description = data?.description ?? "";
    asset.props.image = data?.image ?? "";
    asset.props.favicon = data?.favicon ?? "";
    asset.props.title = data?.title ?? "";
  } catch (e) {
    console.error(e);
  }

  return asset;
}
