import {
  computed,
  IReactionDisposer,
  onBecomeObserved,
  onBecomeUnobserved,
  reaction
} from "mobx";
import { now } from "mobx-utils";
import Constructor from "../Core/Constructor";
import Model from "../Models/Definition/Model";
import AutoRefreshingTraits from "../Traits/TraitsClasses/AutoRefreshingTraits";
import MappableMixin from "./MappableMixin";

type AutoRefreshing = Model<AutoRefreshingTraits>;

export default function AutoRefreshingMixin<
  T extends Constructor<AutoRefreshing>
>(Base: T) {
  abstract class AutoRefreshingMixin extends MappableMixin(Base) {
    _autoRefreshDisposer: IReactionDisposer | undefined;
    _autorunRefreshEnableDisposer: IReactionDisposer | undefined;

    /** Return the interval in seconds to poll for updates. */
    abstract get refreshInterval(): number | undefined;

    /** Call hook for refreshing the item */
    abstract refreshData(): void;

    constructor(...args: any[]) {
      super(...args);
      // We should only poll when our map items have consumers
      onBecomeObserved(this, "mapItems", this._startAutoRefresh.bind(this));
      onBecomeUnobserved(this, "mapItems", this._stopAutoRefresh.bind(this));
    }

    _startAutoRefresh() {
      if (!this._autorunRefreshEnableDisposer) {
        // Toggle autorefresh when `refreshEnabled` trait changes
        this._autorunRefreshEnableDisposer = reaction(
          () => this.refreshEnabled,
          () => {
            if (this.refreshEnabled) {
              this._startAutoRefresh();
            } else {
              this._stopAutoRefresh();
            }
          }
        );
      }
      if (!this._autoRefreshDisposer && this.refreshEnabled) {
        this._autoRefreshDisposer = reaction(
          () => this._pollingTimer,
          () => {
            if (this.show) this.refreshData();
          }
        );
      }
    }

    _stopAutoRefresh() {
      if (this._autorunRefreshEnableDisposer) {
        this._autorunRefreshEnableDisposer();
        this._autorunRefreshEnableDisposer = undefined;
      }
      if (this._autoRefreshDisposer) {
        this._autoRefreshDisposer();
        this._autoRefreshDisposer = undefined;
      }
    }

    @computed
    get _pollingTimer(): number | undefined {
      if (this.refreshInterval !== undefined) {
        return now(this.refreshInterval * 1000);
      } else {
        return undefined;
      }
    }

    @computed
    get isPolling() {
      return this._pollingTimer !== undefined;
    }

    @computed
    get nextScheduledUpdateTime(): Date | undefined {
      if (
        this.refreshEnabled &&
        this._pollingTimer !== undefined &&
        this.refreshInterval !== undefined
      ) {
        return new Date(this._pollingTimer + this.refreshInterval * 1000);
      } else {
        return undefined;
      }
    }
  }

  return AutoRefreshingMixin;
}
