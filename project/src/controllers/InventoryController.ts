import { inject, injectable } from "tsyringe";

import { LootGenerator } from "../generators/LootGenerator";
import { InventoryHelper } from "../helpers/InventoryHelper";
import { ItemHelper } from "../helpers/ItemHelper";
import { PaymentHelper } from "../helpers/PaymentHelper";
import { PresetHelper } from "../helpers/PresetHelper";
import { ProfileHelper } from "../helpers/ProfileHelper";
import { QuestHelper } from "../helpers/QuestHelper";
import { IPmcData } from "../models/eft/common/IPmcData";
import { Item } from "../models/eft/common/tables/IItem";
import { IAddItemRequestData } from "../models/eft/inventory/IAddItemRequestData";
import { IInventoryBindRequestData } from "../models/eft/inventory/IInventoryBindRequestData";
import {
    IInventoryCreateMarkerRequestData
} from "../models/eft/inventory/IInventoryCreateMarkerRequestData";
import {
    IInventoryDeleteMarkerRequestData
} from "../models/eft/inventory/IInventoryDeleteMarkerRequestData";
import {
    IInventoryEditMarkerRequestData
} from "../models/eft/inventory/IInventoryEditMarkerRequestData";
import { IInventoryExamineRequestData } from "../models/eft/inventory/IInventoryExamineRequestData";
import { IInventoryFoldRequestData } from "../models/eft/inventory/IInventoryFoldRequestData";
import { IInventoryMergeRequestData } from "../models/eft/inventory/IInventoryMergeRequestData";
import { IInventoryMoveRequestData } from "../models/eft/inventory/IInventoryMoveRequestData";
import {
    IInventoryReadEncyclopediaRequestData
} from "../models/eft/inventory/IInventoryReadEncyclopediaRequestData";
import { IInventoryRemoveRequestData } from "../models/eft/inventory/IInventoryRemoveRequestData";
import { IInventorySortRequestData } from "../models/eft/inventory/IInventorySortRequestData";
import { IInventorySplitRequestData } from "../models/eft/inventory/IInventorySplitRequestData";
import { IInventorySwapRequestData } from "../models/eft/inventory/IInventorySwapRequestData";
import { IInventoryTagRequestData } from "../models/eft/inventory/IInventoryTagRequestData";
import { IInventoryToggleRequestData } from "../models/eft/inventory/IInventoryToggleRequestData";
import {
    IInventoryTransferRequestData
} from "../models/eft/inventory/IInventoryTransferRequestData";
import {
    IOpenRandomLootContainerRequestData
} from "../models/eft/inventory/IOpenRandomLootContainerRequestData";
import { IItemEventRouterResponse } from "../models/eft/itemEvent/IItemEventRouterResponse";
import { BackendErrorCodes } from "../models/enums/BackendErrorCodes";
import { SkillTypes } from "../models/enums/SkillTypes";
import { Traders } from "../models/enums/Traders";
import { ILogger } from "../models/spt/utils/ILogger";
import { EventOutputHolder } from "../routers/EventOutputHolder";
import { DatabaseServer } from "../servers/DatabaseServer";
import { FenceService } from "../services/FenceService";
import { LocalisationService } from "../services/LocalisationService";
import { RagfairOfferService } from "../services/RagfairOfferService";
import { HashUtil } from "../utils/HashUtil";
import { HttpResponseUtil } from "../utils/HttpResponseUtil";
import { JsonUtil } from "../utils/JsonUtil";
import { RandomUtil } from "../utils/RandomUtil";

@injectable()
export class InventoryController
{
    constructor(
        @inject("WinstonLogger") protected logger: ILogger,
        @inject("HashUtil") protected hashUtil: HashUtil,
        @inject("JsonUtil") protected jsonUtil: JsonUtil,
        @inject("ItemHelper") protected itemHelper: ItemHelper,
        @inject("RandomUtil") protected randomUtil: RandomUtil,
        @inject("DatabaseServer") protected databaseServer: DatabaseServer,
        @inject("FenceService") protected fenceService: FenceService,
        @inject("PresetHelper") protected presetHelper: PresetHelper,
        @inject("InventoryHelper") protected inventoryHelper: InventoryHelper,
        @inject("QuestHelper") protected questHelper: QuestHelper,
        @inject("RagfairOfferService") protected ragfairOfferService: RagfairOfferService,
        @inject("ProfileHelper") protected profileHelper: ProfileHelper,
        @inject("PaymentHelper") protected paymentHelper: PaymentHelper,
        @inject("LocalisationService") protected localisationService: LocalisationService,
        @inject("LootGenerator") protected lootGenerator: LootGenerator,
        @inject("EventOutputHolder") protected eventOutputHolder: EventOutputHolder,
        @inject("HttpResponseUtil") protected httpResponseUtil: HttpResponseUtil
    )
    {}

    /**
    * Move Item
    * change location of item with parentId and slotId
    * transfers items from one profile to another if fromOwner/toOwner is set in the body.
    * otherwise, move is contained within the same profile_f.
     * @param pmcData Profile
     * @param moveRequest Move request data
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public moveItem(pmcData: IPmcData, moveRequest: IInventoryMoveRequestData, sessionID: string): IItemEventRouterResponse
    {
        const output = this.eventOutputHolder.getOutput(sessionID);

        if (output.warnings.length > 0)
        {
            return output;
        }

        // Changes made to result apply to character inventory
        const items = this.inventoryHelper.getOwnerInventoryItems(moveRequest, sessionID);
        if (items.sameInventory)
        {
            // Dont move items from trader to profile, this can happen when editing a traders preset weapons
            if (moveRequest.fromOwner?.type === "Trader" && !items.isMail)
            {
                return this.getTraderExploitErrorResponse(output);
            }

            // Check for item in inventory before allowing internal transfer
            const originalItemLocation = items.from.find(x => x._id === moveRequest.item);
            if (!originalItemLocation)
            {
                // Internal item move but item never existed, likely a dupe glitch
                return this.getTraderExploitErrorResponse(output);
            }

            this.inventoryHelper.moveItemInternal(pmcData, items.from, moveRequest);
        }
        else
        {
            this.inventoryHelper.moveItemToProfile(items.from, items.to, moveRequest);
        }
        return output;
    }

    /**
     * Get a event router response with inventory trader message
     * @param output Item event router response
     * @returns Item event router response
     */
    protected getTraderExploitErrorResponse(output: IItemEventRouterResponse): IItemEventRouterResponse
    {
        return this.httpResponseUtil.appendErrorToOutput(output, this.localisationService.getText("inventory-edit_trader_item"), <BackendErrorCodes>228);
    }

    /**
    * Remove Item from Profile
    * Deep tree item deletion, also removes items from insurance list
    */
    public removeItem(pmcData: IPmcData, itemId: string, sessionID: string, output: IItemEventRouterResponse = undefined): IItemEventRouterResponse
    {
        return this.inventoryHelper.removeItem(pmcData, itemId, sessionID, output);
    }

    /**
     * Implements functionality "Discard" from Main menu (Stash etc.)
     * Removes item from PMC Profile
     */
    public discardItem(pmcData: IPmcData, body: IInventoryRemoveRequestData, sessionID: string): IItemEventRouterResponse
    {
        return this.inventoryHelper.removeItem(pmcData, body.item, sessionID, this.eventOutputHolder.getOutput(sessionID));
    }

    /**
     * Split Item
     * spliting 1 stack into 2
     * @param pmcData Player profile (unused, getOwnerInventoryItems() gets profile)
     * @param request Split request
     * @param sessionID Session/player id
     * @returns IItemEventRouterResponse
     */
    public splitItem(pmcData: IPmcData, request: IInventorySplitRequestData, sessionID: string): IItemEventRouterResponse
    {
        const output = this.eventOutputHolder.getOutput(sessionID);

        // Changes made to result apply to character inventory
        const inventoryItems = this.inventoryHelper.getOwnerInventoryItems(request, sessionID);

        // Handle cartridge edge-case
        if (!request.container.location && request.container.container === "cartridges")
        {
            const matchingItems = inventoryItems.to.filter(x => x.parentId === request.container.id);
            request.container.location = matchingItems.length; // Wrong location for first cartridge
        }

        // The item being merged has three possible sources: pmc, scav or mail, getOwnerInventoryItems() handles getting correct one
        const itemToSplit = inventoryItems.from.find(x => x._id === request.splitItem);
        if (!itemToSplit)
        {
            const errorMessage = (`Unable to split stack as source item: ${request.splitItem} cannot be found`);
            this.logger.error(errorMessage);

            return this.httpResponseUtil.appendErrorToOutput(output, errorMessage);
        }

        // Create new upd object that retains properties of original upd + new stack count size
        const updatedUpd = this.jsonUtil.clone(itemToSplit.upd);
        updatedUpd.StackObjectsCount = request.count;

        // Remove split item count from source stack
        itemToSplit.upd.StackObjectsCount -= request.count;

        // Inform client of change
        output.profileChanges[sessionID].items.new.push({
            _id: request.newItem,
            _tpl: itemToSplit._tpl,
            upd: updatedUpd
        });

        // Update player inventory
        inventoryItems.to.push({
            _id: request.newItem,
            _tpl: itemToSplit._tpl,
            parentId: request.container.id,
            slotId: request.container.container,
            location: request.container.location,
            upd: updatedUpd
        });

        return output;
    }

    /**
     * Fully merge 2 inventory stacks together into one stack (merging where both stacks remain is called 'transfer')
     * Deletes item from `body.item` and adding number of stacks into `body.with`
     * @param pmcData Player profile (unused, getOwnerInventoryItems() gets profile)
     * @param body Merge request
     * @param sessionID Player id
     * @returns IItemEventRouterResponse
     */
    public mergeItem(pmcData: IPmcData, body: IInventoryMergeRequestData, sessionID: string): IItemEventRouterResponse
    {
        const output = this.eventOutputHolder.getOutput(sessionID);

        // Changes made to result apply to character inventory
        const inventoryItems = this.inventoryHelper.getOwnerInventoryItems(body, sessionID);

        // Get source item
        const sourceItem = inventoryItems.from.find(x => x._id === body.item);
        if (!sourceItem)
        {
            const errorMessage = (`Unable to merge stacks as source item: ${body.with} cannot be found`);
            this.logger.error(errorMessage);

            return this.httpResponseUtil.appendErrorToOutput(output, errorMessage);
        }

        // Get item being merged into
        const destinationItem = inventoryItems.to.find(x => x._id === body.with);
        if (!destinationItem)
        {
            const errorMessage = (`Unable to merge stacks as destination item: ${body.with} cannot be found`);
            this.logger.error(errorMessage);

            return this.httpResponseUtil.appendErrorToOutput(output, errorMessage);
        }

        if (!(destinationItem.upd?.StackObjectsCount))
        {
            // No stackcount on destination, add one
            destinationItem.upd = { StackObjectsCount: 1 };
        }
        else if (!(sourceItem.upd?.StackObjectsCount))
        {
            // No stackcount on source, add one
            sourceItem.upd = { StackObjectsCount: 1 };
        }

        destinationItem.upd.StackObjectsCount += sourceItem.upd.StackObjectsCount; // Add source stackcount to destination
        output.profileChanges[sessionID].items.del.push({ _id: sourceItem._id }); // Inform client source item being deleted
        inventoryItems.to.splice(inventoryItems.to.findIndex(x => x._id === sourceItem._id), 1); // remove source item from pmc inventory

        return output;
    }

    /**
     * TODO: Adds no data to output to send to client, is this by design?
     * TODO: should make use of getOwnerInventoryItems(), stack being transferred may not always be on pmc
     * Transfer items from one stack into another while keeping original stack
     * Used to take items from scav inventory into stash or to insert ammo into mags (shotgun ones) and reloading weapon by clicking "Reload"
     * @param pmcData Player profile
     * @param body Transfer request
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public transferItem(pmcData: IPmcData, body: IInventoryTransferRequestData, sessionID: string): IItemEventRouterResponse
    {
        const output = this.eventOutputHolder.getOutput(sessionID);

        let sourceItem: Item = null;
        let destinationItem: Item = null;
        for (const iterItem of pmcData.Inventory.items)
        {
            if (iterItem._id === body.item)
            {
                // Found source item
                sourceItem = iterItem;
            }
            else if (iterItem._id === body.with)
            {
                // Found destination item
                destinationItem = iterItem;
            }

            if (sourceItem !== null && destinationItem !== null)
            {
                // Both items found, exit loop
                break; 
            }
        }

        if (sourceItem === null || destinationItem === null)
        {
            const errorMessage = `Unable to transfer stack, cannot find source: ${body.item} or destination: ${body.with} `;
            this.logger.error(errorMessage);

            return this.httpResponseUtil.appendErrorToOutput(output, errorMessage);
        }

        let sourceStackCount = 1;
        if (!sourceItem.upd)
        {
            sourceItem.upd = {StackObjectsCount: 1};
        }
        sourceStackCount = sourceItem.upd.StackObjectsCount;

        if (sourceStackCount > body.count)
        {
            // Source items stack count greater than new desired count
            sourceItem.upd.StackObjectsCount = sourceStackCount - body.count;
        }
        else
        {
            // Moving a full stack onto a smaller stack
            sourceItem.upd.StackObjectsCount = sourceStackCount - 1;
        }

        let destinationStackCount = 1;
        if (destinationItem.upd)
        {
            destinationStackCount = destinationItem.upd.StackObjectsCount;
        }
        else
        {
            Object.assign(destinationItem, { upd: { StackObjectsCount: 1 } });
        }

        destinationItem.upd.StackObjectsCount = destinationStackCount + body.count;

        return output;
    }

    /**
    * Swap Item
    * its used for "reload" if you have weapon in hands and magazine is somewhere else in rig or backpack in equipment
    * Also used to swap items using quick selection on character screen
    */
    public swapItem(pmcData: IPmcData, request: IInventorySwapRequestData, sessionID: string): IItemEventRouterResponse
    {
        const itemOne = pmcData.Inventory.items.find(x => x._id === request.item);
        if (!itemOne)
        {
            this.logger.error(`Unable to find item: ${request.item} to swap positions with: ${request.item2}`);
        }

        const itemTwo = pmcData.Inventory.items.find(x => x._id === request.item2);
        if (!itemTwo)
        {
            this.logger.error(`Unable to find item: ${request.item2} to swap positions with: ${request.item}`);
        }

        // to.id is the parentid
        itemOne.parentId = request.to.id;
        
        // to.container is the slotid
        itemOne.slotId = request.to.container;

        // Request object has location data, add it in, otherwise remove existing location from object
        if (request.to.location)
        {
            itemOne.location = request.to.location;
        }
        else
        {
            delete itemOne.location;
        }

        itemTwo.parentId = request.to2.id;
        itemTwo.slotId = request.to2.container;
        if (request.to2.location)
        {
            itemTwo.location = request.to2.location;
        }
        else
        {
            delete itemTwo.location;
        }

        // Client already informed of inventory locations, nothing for us to do
        return this.eventOutputHolder.getOutput(sessionID);
    }

    /**
     * Handles folding of Weapons
     */
    public foldItem(pmcData: IPmcData, body: IInventoryFoldRequestData, sessionID: string): IItemEventRouterResponse
    {
        // Fix for folding weapons while on they're in the Scav inventory
        if (body.fromOwner
            && body.fromOwner.type === "Profile"
            && body.fromOwner.id !== pmcData._id)
        {
            pmcData = this.profileHelper.getScavProfile(sessionID);
        }

        for (const item of pmcData.Inventory.items)
        {
            if (item._id && item._id === body.item)
            {
                item.upd.Foldable = { "Folded": body.value };
                return this.eventOutputHolder.getOutput(sessionID);
            }
        }

        return {
            warnings: [],
            profileChanges: {}
        };
    }

    /**
     * Toggles "Toggleable" items like night vision goggles and face shields.
     * @param pmcData player profile
     * @param body Toggle request
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public toggleItem(pmcData: IPmcData, body: IInventoryToggleRequestData, sessionID: string): IItemEventRouterResponse
    {
        // Fix for toggling items while on they're in the Scav inventory
        if (body.fromOwner && body.fromOwner.type === "Profile" && body.fromOwner.id !== pmcData._id)
        {
            pmcData = this.profileHelper.getScavProfile(sessionID);
        }

        const itemToToggle = pmcData.Inventory.items.find(x => x._id === body.item);
        if (itemToToggle)
        {
            if (!itemToToggle.upd)
            {
                this.logger.warning(this.localisationService.getText("inventory-item_to_toggle_missing_upd", itemToToggle._id));
                itemToToggle.upd = {};
            }

            itemToToggle.upd.Togglable = { On: body.value };

            return this.eventOutputHolder.getOutput(sessionID);
        }
        else
        {
            this.logger.warning(this.localisationService.getText("inventory-unable_to_toggle_item_not_found", body.item));
        }

        return {
            warnings: [],
            profileChanges: {}
        };
    }

    /**
     * Add a tag to an inventory item
     * @param pmcData profile with item to add tag to
     * @param body tag request data
     * @param sessionID session id
     * @returns client response object
     */
    public tagItem(pmcData: IPmcData, body: IInventoryTagRequestData, sessionID: string): IItemEventRouterResponse
    {
        for (const item of pmcData.Inventory.items)
        {
            if (item._id === body.item)
            {
                if ("upd" in item)
                {
                    item.upd.Tag = { Color: body.TagColor, Name: body.TagName };
                }
                else
                {
                    item.upd = { Tag: { Color: body.TagColor, Name: body.TagName } };
                }

                return this.eventOutputHolder.getOutput(sessionID);
            }
        }

        return {
            warnings: [],
            profileChanges: {}
        };
    }

    /**
     * Bind an inventory item to the quick access menu at bottom of player screen
     * @param pmcData Player profile
     * @param bindRequest Reqeust object
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public bindItem(pmcData: IPmcData, bindRequest: IInventoryBindRequestData, sessionID: string): IItemEventRouterResponse
    {
        for (const index in pmcData.Inventory.fastPanel)
        {
            if (pmcData.Inventory.fastPanel[index] === bindRequest.item)
            {
                pmcData.Inventory.fastPanel[index] = "";
            }
        }

        pmcData.Inventory.fastPanel[bindRequest.index] = bindRequest.item;

        return this.eventOutputHolder.getOutput(sessionID);
    }


    /**
     * Handles examining an item
     * @param pmcData player profile
     * @param body request object
     * @param sessionID session id
     * @returns response
     */
    public examineItem(pmcData: IPmcData, body: IInventoryExamineRequestData, sessionID: string): IItemEventRouterResponse
    {
        let itemId = "";
        if ("fromOwner" in body)
        {
            try
            {
                itemId = this.getExaminedItemTpl(body);
            }
            catch
            {
                this.logger.error(this.localisationService.getText("inventory-examine_item_does_not_exist", body.item));
            }
            
            // get hideout item
            if (body.fromOwner.type === "HideoutProduction")
            {
                itemId = body.item;
            }
        }

        if (!itemId)
        {
            // item template
            if (body.item in this.databaseServer.getTables().templates.items)
            {
                itemId = body.item;
            }
        }

        if (!itemId)
        {
            // player inventory
            const target = pmcData.Inventory.items.find((item) =>
            {
                return body.item === item._id;
            });

            if (target)
            {
                itemId = target._tpl;
            }
        }

        if (itemId)
        {
            // item found
            const item = this.databaseServer.getTables().templates.items[itemId];

            pmcData.Info.Experience += item._props.ExamineExperience;
            pmcData.Encyclopedia[itemId] = true;

            // TODO: update this with correct calculation using values from globals json
            this.questHelper.rewardSkillPoints(sessionID, pmcData, SkillTypes.INTELLECT, 0.5);
        }

        return this.eventOutputHolder.getOutput(sessionID);
    }

    /**
     * Get the tplid of an item from the examine request object
     * @param body response request
     * @returns tplid
     */
    protected getExaminedItemTpl(body: IInventoryExamineRequestData): string
    {
        if (this.presetHelper.isPreset(body.item))
        {
            return this.presetHelper.getBaseItemTpl(body.item);
        }
        else if (body.fromOwner.id === Traders.FENCE)
        {
            // get tpl from fence assorts
            return this.fenceService.getRawFenceAssorts().items.find(x => x._id === body.item)._tpl;
        }
        else if (body.fromOwner.type === "Trader") // not fence
        {
            // get tpl from trader assort
            return this.databaseServer.getTables().traders[body.fromOwner.id].assort.items.find(item => item._id === body.item)._tpl;
        }
        else if (body.fromOwner.type === "RagFair")
        {
            // try to get tplid from items.json first
            const item = this.databaseServer.getTables().templates.items[body.item];
            if (item)
            {
                return item._id;
            }

            // try alternate way of getting offer if first approach fails
            let offer = this.ragfairOfferService.getOfferByOfferId(body.item);
            if (!offer)
            {
                offer = this.ragfairOfferService.getOfferByOfferId(body.fromOwner.id);
            }

            // try find examine item inside offer items array
            const matchingItem = offer.items.find(x => x._id === body.item);
            if (matchingItem)
            {
                return matchingItem._tpl;
            } 

            // unable to find item in database or ragfair
            throw new Error(this.localisationService.getText("inventory-unable_to_find_item", body.item));
        }
    }

    public readEncyclopedia(pmcData: IPmcData, body: IInventoryReadEncyclopediaRequestData, sessionID: string): IItemEventRouterResponse
    {
        for (const id of body.ids)
        {
            pmcData.Encyclopedia[id] = true;
        }

        return this.eventOutputHolder.getOutput(sessionID);
    }

    /**
     * Handle ApplyInventoryChanges
     * Sorts supplied items.
     * @param pmcData Player profile
     * @param request sort request
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public sortInventory(pmcData: IPmcData, request: IInventorySortRequestData, sessionID: string): IItemEventRouterResponse
    {

        for (const change of request.changedItems)
        {
            const inventoryItem = pmcData.Inventory.items.find(x => x._id === change._id);
            if (!inventoryItem)
            {
                this.logger.error(`Unable to find inventory item: ${change._id} to auto-sort, YOU MUST RELOAD YOUR GAME`);

                continue;
            }

            inventoryItem.parentId = change.parentId;
            inventoryItem.slotId = change.slotId;
            if (change.location)
            {
                inventoryItem.location = change.location;
            }
            else
            {
                delete inventoryItem.location;
            }
        }

        return this.eventOutputHolder.getOutput(sessionID);
    }

    /**
     * Add note to a map
     * @param pmcData Player profile
     * @param request Add marker request
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public createMapMarker(pmcData: IPmcData, request: IInventoryCreateMarkerRequestData, sessionID: string): IItemEventRouterResponse
    {
        // Get map from inventory
        const mapItem = pmcData.Inventory.items.find(i => i._id === request.item);

        // add marker
        mapItem.upd.Map = mapItem.upd.Map || { Markers: [] };
        request.mapMarker.Note = this.sanitiseMapMarkerText(request.mapMarker.Note);
        mapItem.upd.Map.Markers.push(request.mapMarker);

        // sync with client
        const output = this.eventOutputHolder.getOutput(sessionID);
        output.profileChanges[sessionID].items.change.push(mapItem);

        return output;
    }

    /**
     * Delete a map marker
     * @param pmcData Player profile
     * @param request Delete marker request
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public deleteMapMarker(pmcData: IPmcData, request: IInventoryDeleteMarkerRequestData, sessionID: string): IItemEventRouterResponse
    {
        // Get map from inventory
        const mapItem = pmcData.Inventory.items.find(i => i._id === request.item);

        // remove marker
        const markers = mapItem.upd.Map.Markers.filter((marker) =>
        {
            return marker.X !== request.X && marker.Y !== request.Y;
        });
        mapItem.upd.Map.Markers = markers;

        // sync with client
        const output = this.eventOutputHolder.getOutput(sessionID);
        output.profileChanges[sessionID].items.change.push(mapItem);
        return output;
    }

    /**
     * Edit an existing map marker
     * @param pmcData Player profile
     * @param request Edit marker request
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public editMapMarker(pmcData: IPmcData, request: IInventoryEditMarkerRequestData, sessionID: string): IItemEventRouterResponse
    {
        // Get map from inventory
        const mapItem = pmcData.Inventory.items.find(i => i._id === request.item);

        // edit marker
        const indexOfExistingNote = mapItem.upd.Map.Markers.findIndex(m => m.X === request.X && m.Y === request.Y);
        request.mapMarker.Note = this.sanitiseMapMarkerText(request.mapMarker.Note);
        mapItem.upd.Map.Markers[indexOfExistingNote] = request.mapMarker;

        // sync with client
        const output = this.eventOutputHolder.getOutput(sessionID);
        output.profileChanges[sessionID].items.change.push(mapItem);

        return output;
    }

    /**
     * Strip out characters from note string that are not: letter/numbers/unicode/spaces
     * @param mapNoteText Marker text to sanitise
     * @returns Sanitised map marker text
     */
    protected sanitiseMapMarkerText(mapNoteText: string): string
    {
        return mapNoteText.replace(/[^\p{L}\d ]/gu, "");
    }

    /**
     * Handle OpenRandomLootContainer event
     * Handle event fired when a container is unpacked (currently only the halloween pumpkin)
     * @param pmcData Profile data
     * @param body open loot container request data
     * @param sessionID Session id
     * @returns IItemEventRouterResponse
     */
    public openRandomLootContainer(pmcData: IPmcData, body: IOpenRandomLootContainerRequestData, sessionID: string): IItemEventRouterResponse
    {
        const openedItem = pmcData.Inventory.items.find(x => x._id === body.item);
        const containerDetails = this.itemHelper.getItem(openedItem._tpl);
        const isSealedWeaponBox = containerDetails[1]._name.includes("event_container_airdrop");

        const newItemRequest: IAddItemRequestData = {
            tid: "RandomLootContainer",
            items: []
        };

        let foundInRaid = false;
        if (isSealedWeaponBox)
        {
            const containerSettings = this.inventoryHelper.getInventoryConfig().sealedAirdropContainer;
            newItemRequest.items.push(...this.lootGenerator.getSealedWeaponCaseLoot(containerSettings));

            foundInRaid = containerSettings.foundInRaid;
        }
        else
        {
            // Get summary of loot from config
            const rewardContainerDetails = this.inventoryHelper.getRandomLootContainerRewardDetails(openedItem._tpl);
            newItemRequest.items.push(...this.lootGenerator.getRandomLootContainerLoot(rewardContainerDetails));

            foundInRaid = rewardContainerDetails.foundInRaid;
        }

        const output = this.eventOutputHolder.getOutput(sessionID);

        // Find and delete opened item from player inventory
        this.inventoryHelper.removeItem(pmcData, body.item, sessionID, output);

        // Add reward items to player inventory
        this.inventoryHelper.addItem(pmcData, newItemRequest, output, sessionID, null, foundInRaid, null, true);

        return output;
    }
}