import type { ConnectorProvider } from "@prisma/client";
import Image from "next/image";

import { cn } from "@/lib/utils/cn";

type ProviderLogoProps = {
  className?: string;
  imageClassName?: string;
};

type ProviderLogoAsset = {
  height: number;
  imageClassName?: string;
  src: string;
  tileClassName?: string;
  width: number;
};

type ConnectorProviderLogoProps = ProviderLogoProps & {
  provider: ConnectorProvider;
};

const providerLogoAssets: Partial<
  Record<ConnectorProvider, ProviderLogoAsset>
> = {
  META_ADS: {
    height: 340,
    src: "/connector-logos/meta.png",
    tileClassName: "w-10 bg-[#eef3ff]",
    width: 512,
  },
  GOOGLE_ADS: {
    height: 460,
    src: "/connector-logos/google-ads.jpg",
    width: 512,
  },
  GA4: {
    height: 512,
    src: "/connector-logos/google-analytics.png",
    width: 442,
  },
  SHOPIFY: {
    height: 396,
    src: "/connector-logos/shopify.png",
    width: 348,
  },
  NUVEMSHOP: {
    height: 368,
    src: "/connector-logos/nuvemshop.png",
    tileClassName: "w-10",
    width: 512,
  },
  ISET: {
    height: 94,
    src: "/connector-logos/iset.png",
    tileClassName: "w-12",
    width: 414,
  },
  TRAY: {
    height: 201,
    src: "/connector-logos/tray.webp",
    tileClassName: "w-12",
    width: 448,
  },
  WBUY: {
    height: 174,
    src: "/connector-logos/wbuy.webp",
    tileClassName: "w-14",
    width: 512,
  },
  MAGAZORD: {
    height: 512,
    src: "/connector-logos/magazord.jpg",
    width: 455,
  },
  GOOGLE_SHEETS: {
    height: 176,
    src: "/connector-logos/google-sheets.png",
    width: 128,
  },
};

function fallbackLabel(provider: ConnectorProvider) {
  return provider
    .split("_")
    .map((part) => part[0])
    .join("")
    .slice(0, 2);
}

export function ProviderLogo({
  className,
  imageClassName,
  provider,
}: ConnectorProviderLogoProps) {
  const asset = providerLogoAssets[provider];

  if (!asset) {
    return (
      <span
        aria-hidden="true"
        className={cn(
          "grid size-8 shrink-0 place-items-center rounded-md bg-[var(--bg-elevated)] text-[0.625rem] font-semibold text-[var(--text-tertiary)] shadow-[0_0_0_1px_rgba(15,15,14,0.08)]",
          className,
        )}
      >
        {fallbackLabel(provider)}
      </span>
    );
  }

  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid size-8 shrink-0 place-items-center overflow-hidden rounded-md bg-white p-1 shadow-[0_0_0_1px_rgba(15,15,14,0.08)]",
        asset.tileClassName,
        className,
      )}
    >
      <Image
        alt=""
        className={cn(
          "max-h-full max-w-full object-contain",
          asset.imageClassName,
          imageClassName,
        )}
        height={asset.height}
        src={asset.src}
        width={asset.width}
      />
    </span>
  );
}

export function GoogleAdsLogo(props: ProviderLogoProps) {
  return <ProviderLogo provider="GOOGLE_ADS" {...props} />;
}

export function MetaAdsLogo(props: ProviderLogoProps) {
  return <ProviderLogo provider="META_ADS" {...props} />;
}
