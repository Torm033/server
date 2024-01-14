import { inject, injectable } from "tsyringe";

import { InventoryHelper } from "@spt-aki/helpers/InventoryHelper";
import { ItemHelper } from "@spt-aki/helpers/ItemHelper";
import { TraderHelper } from "@spt-aki/helpers/TraderHelper";
import { IPmcData } from "@spt-aki/models/eft/common/IPmcData";
import { Item, Upd } from "@spt-aki/models/eft/common/tables/IItem";
import { IAddItemDirectRequest } from "@spt-aki/models/eft/inventory/IAddItemDirectRequest";
import { IItemEventRouterResponse } from "@spt-aki/models/eft/itemEvent/IItemEventRouterResponse";
import { IProcessBuyTradeRequestData } from "@spt-aki/models/eft/trade/IProcessBuyTradeRequestData";
import { IProcessSellTradeRequestData } from "@spt-aki/models/eft/trade/IProcessSellTradeRequestData";
import { ConfigTypes } from "@spt-aki/models/enums/ConfigTypes";
import { Traders } from "@spt-aki/models/enums/Traders";
import { ITraderConfig } from "@spt-aki/models/spt/config/ITraderConfig";
import { ILogger } from "@spt-aki/models/spt/utils/ILogger";
import { EventOutputHolder } from "@spt-aki/routers/EventOutputHolder";
import { ConfigServer } from "@spt-aki/servers/ConfigServer";
import { RagfairServer } from "@spt-aki/servers/RagfairServer";
import { FenceService } from "@spt-aki/services/FenceService";
import { PaymentService } from "@spt-aki/services/PaymentService";
import { HttpResponseUtil } from "@spt-aki/utils/HttpResponseUtil";
import { JsonUtil } from "@spt-aki/utils/JsonUtil";

@injectable()
export class TradeHelper
{
    protected traderConfig: ITraderConfig;

    constructor(
        @inject("WinstonLogger") protected logger: ILogger,
        @inject("JsonUtil") protected jsonUtil: JsonUtil,
        @inject("EventOutputHolder") protected eventOutputHolder: EventOutputHolder,
        @inject("TraderHelper") protected traderHelper: TraderHelper,
        @inject("ItemHelper") protected itemHelper: ItemHelper,
        @inject("PaymentService") protected paymentService: PaymentService,
        @inject("FenceService") protected fenceService: FenceService,
        @inject("HttpResponseUtil") protected httpResponse: HttpResponseUtil,
        @inject("InventoryHelper") protected inventoryHelper: InventoryHelper,
        @inject("RagfairServer") protected ragfairServer: RagfairServer,
        @inject("ConfigServer") protected configServer: ConfigServer,
    )
    {
        this.traderConfig = this.configServer.getConfig(ConfigTypes.TRADER);
    }

    /**
     * Buy item from flea or trader
     * @param pmcData Player profile
     * @param buyRequestData data from client
     * @param sessionID Session id
     * @param foundInRaid Should item be found in raid
     * @param upd optional item details used when buying from flea
     * @returns
     */
    public buyItem(
        pmcData: IPmcData,
        buyRequestData: IProcessBuyTradeRequestData,
        sessionID: string,
        foundInRaid: boolean,
        upd: Upd,
    ): IItemEventRouterResponse
    {
        let output = this.eventOutputHolder.getOutput(sessionID);

        const newReq = {
            items: [{
                // eslint-disable-next-line @typescript-eslint/naming-convention
                item_id: buyRequestData.item_id,
                count: buyRequestData.count,
            }],
            tid: buyRequestData.tid,
        };

        const callback = () =>
        {
            // Update assort/flea item values
            let itemPurchased: Item;
            const isRagfair = buyRequestData.tid.toLocaleLowerCase() === "ragfair";
            if (isRagfair)
            {
                const allOffers = this.ragfairServer.getOffers();
                // We store ragfair offerid in buyRequestData.item_id
                const offersWithItem = allOffers.find((x) => x._id === buyRequestData.item_id);
                itemPurchased = offersWithItem.items[0];
            }
            else
            {
                const traderAssorts = this.traderHelper.getTraderAssortsByTraderId(buyRequestData.tid).items;
                itemPurchased = traderAssorts.find((x) => x._id === buyRequestData.item_id);
            }

            // Ensure purchase does not exceed trader item limit
            const hasBuyRestrictions = this.itemHelper.hasBuyRestrictions(itemPurchased);
            if (hasBuyRestrictions)
            {
                this.checkPurchaseIsWithinTraderItemLimit(itemPurchased, buyRequestData.item_id, buyRequestData.count);
            }

            // Decrement trader item count
            if (!isRagfair)
            {
                itemPurchased.upd.StackObjectsCount -= buyRequestData.count;
            }

            if (this.traderConfig.persistPurchaseDataInProfile && hasBuyRestrictions)
            {
                this.traderHelper.addTraderPurchasesToPlayerProfile(sessionID, newReq);
            }

            /// Pay for item
            output = this.paymentService.payMoney(pmcData, buyRequestData, sessionID, output);
            if (output.warnings.length > 0)
            {
                throw new Error(`Transaction failed: ${output.warnings[0].errmsg}`);
            }

            if (buyRequestData.tid === Traders.FENCE)
            {
                // Bought fence offer, remove from listing
                this.fenceService.removeFenceOffer(buyRequestData.item_id);
            }
            else if (hasBuyRestrictions)
            {
                // Increment non-fence trader item buy count
                this.incrementAssortBuyCount(itemPurchased, buyRequestData.count);
            }
        };

        if (buyRequestData.tid.toLocaleLowerCase() === "ragfair")
        {
            const allOffers = this.ragfairServer.getOffers();
            const offersWithItem = allOffers.find((x) => x._id === buyRequestData.item_id);

            const request: IAddItemDirectRequest = {
                itemWithModsToAdd: offersWithItem.items,
                foundInRaid: true,
                callback: callback,
                useSortingTable: true
            }

            return this.inventoryHelper.addItemToInventory(sessionID, request, pmcData, output);
        }

        // TODO - handle traders
        // TODO - handle fence

        return this.inventoryHelper.addItem(pmcData, newReq, output, sessionID, callback, foundInRaid, upd);
    }

    /**
     * Sell item to trader
     * @param profileWithItemsToSell Profile to remove items from
     * @param profileToReceiveMoney Profile to accept the money for selling item
     * @param sellRequest Request data
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public sellItem(
        profileWithItemsToSell: IPmcData,
        profileToReceiveMoney: IPmcData,
        sellRequest: IProcessSellTradeRequestData,
        sessionID: string,
    ): IItemEventRouterResponse
    {
        let output = this.eventOutputHolder.getOutput(sessionID);

        // Find item in inventory and remove it
        for (const itemToBeRemoved of sellRequest.items)
        {
            const itemIdToFind = itemToBeRemoved.id.replace(/\s+/g, ""); // Strip out whitespace

            // Find item in player inventory, or show error to player if not found
            const matchingItemInInventory = profileWithItemsToSell.Inventory.items.find((x) => x._id === itemIdToFind);
            if (!matchingItemInInventory)
            {
                const errorMessage = `Unable to sell item ${itemToBeRemoved.id}, cannot be found in player inventory`;
                this.logger.error(errorMessage);

                return this.httpResponse.appendErrorToOutput(output, errorMessage);
            }

            this.logger.debug(`Selling: id: ${matchingItemInInventory._id} tpl: ${matchingItemInInventory._tpl}`);

            // Also removes children
            output = this.inventoryHelper.removeItem(profileWithItemsToSell, itemToBeRemoved.id, sessionID, output);
        }

        // Give player money for sold item(s)
        return this.paymentService.getMoney(profileToReceiveMoney, sellRequest.price, sellRequest, output, sessionID);
    }

    /**
     * Increment the assorts buy count by number of items purchased
     * Show error on screen if player attempts to buy more than what the buy max allows
     * @param assortBeingPurchased assort being bought
     * @param itemsPurchasedCount number of items being bought
     */
    protected incrementAssortBuyCount(assortBeingPurchased: Item, itemsPurchasedCount: number): void
    {
        assortBeingPurchased.upd.BuyRestrictionCurrent += itemsPurchasedCount;

        if (assortBeingPurchased.upd.BuyRestrictionCurrent > assortBeingPurchased.upd.BuyRestrictionMax)
        {
            throw new Error("Unable to purchase item, Purchase limit reached");
        }
    }

    /**
     * Traders allow a limited number of purchases per refresh cycle (default 60 mins)
     * @param assortBeingPurchased the item from trader being bought
     * @param assortId Id of assort being purchased
     * @param count How many are being bought
     */
    protected checkPurchaseIsWithinTraderItemLimit(assortBeingPurchased: Item, assortId: string, count: number): void
    {
        if ((assortBeingPurchased.upd.BuyRestrictionCurrent + count) > assortBeingPurchased.upd?.BuyRestrictionMax)
        {
            throw new Error(
                `Unable to purchase ${count} items, this would exceed your purchase limit of ${assortBeingPurchased.upd.BuyRestrictionMax} from the traders assort: ${assortId} this refresh`,
            );
        }
    }
}
