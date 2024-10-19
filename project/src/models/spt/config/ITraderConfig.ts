import { MinMax } from "@spt/models/common/MinMax";
import { IBaseConfig } from "@spt/models/spt/config/IBaseConfig";
import { ILootRequest } from "@spt/models/spt/services/ILootRequest";

export interface ITraderConfig extends IBaseConfig {
    kind: "spt-trader";
    updateTime: UpdateTime[];
    purchasesAreFoundInRaid: boolean;
    /** Should trader reset times be set based on server start time (false = bsg time - on the hour) */
    tradersResetFromServerStart: boolean;
    updateTimeDefault: number;
    traderPriceMultipler: number;
    fence: FenceConfig;
    moddedTraders: ModdedTraders;
}

export interface UpdateTime {
    traderId: string;
    /** Seconds between trader resets */
    seconds: MinMax;
}

export interface FenceConfig {
    discountOptions: DiscountOptions;
    partialRefreshTimeSeconds: number;
    partialRefreshChangePercent: number;
    assortSize: number;
    weaponPresetMinMax: MinMax;
    equipmentPresetMinMax: MinMax;
    itemPriceMult: number;
    presetPriceMult: number;
    armorMaxDurabilityPercentMinMax: IItemDurabilityCurrentMax;
    weaponDurabilityPercentMinMax: IItemDurabilityCurrentMax;
    /** Keyed to plate protection level */
    chancePlateExistsInArmorPercent: Record<string, number>;
    /** Key: item tpl */
    itemStackSizeOverrideMinMax: Record<string, MinMax>;
    itemTypeLimits: Record<string, number>;
    /** Prevent duplicate offers of items of specific categories by parentId */
    preventDuplicateOffersOfCategory: string[];
    regenerateAssortsOnRefresh: boolean;
    /** Max rouble price before item is not listed on flea */
    itemCategoryRoublePriceLimit: Record<string, number>;
    /** Each slotid with % to be removed prior to listing on fence */
    presetSlotsToRemoveChancePercent: Record<string, number>;
    /** Block seasonal items from appearing when season is inactive */
    blacklistSeasonalItems: boolean;
    /** Max pen value allowed to be listed on flea - affects ammo + ammo boxes */
    ammoMaxPenLimit: number;
    blacklist: string[];
    coopExtractGift: CoopExtractReward;
    btrDeliveryExpireHours: number;
}

export interface IItemDurabilityCurrentMax {
    current: MinMax;
    max: MinMax;
}

export interface CoopExtractReward extends ILootRequest {
    sendGift: boolean;
    messageLocaleIds: string[];
    giftExpiryHours: number;
}

export interface DiscountOptions {
    assortSize: number;
    itemPriceMult: number;
    presetPriceMult: number;
    weaponPresetMinMax: MinMax;
    equipmentPresetMinMax: MinMax;
}

/** Custom trader data needed client side for things such as the clothing service */
export interface ModdedTraders {
    /** Trader Ids to enable the clothing service for */
    clothingService: string[];
}
