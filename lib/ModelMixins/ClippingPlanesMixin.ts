import i18next from "i18next";
import {
  action,
  autorun,
  computed,
  IReactionDisposer,
  onBecomeObserved,
  onBecomeUnobserved,
  toJS,
  trace
} from "mobx";
import BoundingSphere from "terriajs-cesium/Source/Core/BoundingSphere";
import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import clone from "terriajs-cesium/Source/Core/clone";
import Color from "terriajs-cesium/Source/Core/Color";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import CesiumMath from "terriajs-cesium/Source/Core/Math";
import Matrix4 from "terriajs-cesium/Source/Core/Matrix4";
import Ray from "terriajs-cesium/Source/Core/Ray";
import CallbackProperty from "terriajs-cesium/Source/DataSources/CallbackProperty";
import CustomDataSource from "terriajs-cesium/Source/DataSources/CustomDataSource";
import PlaneGraphics from "terriajs-cesium/Source/DataSources/PlaneGraphics";
import ClippingPlane from "terriajs-cesium/Source/Scene/ClippingPlane";
import ClippingPlaneCollection from "terriajs-cesium/Source/Scene/ClippingPlaneCollection";
import Constructor from "../Core/Constructor";
import Cesium from "../Models/Cesium";
import ClippingPlanesController, {
  ClippingPlaneEvent
} from "../Models/ClippingPlanesController";
import CommonStrata from "../Models/Definition/CommonStrata";
import Model from "../Models/Definition/Model";
import { SelectableDimensionGroup } from "../Models/SelectableDimensions";
import Terria from "../Models/Terria";
import ClippingPlanesTraits from "../Traits/TraitsClasses/ClippingPlanesTraits";

type BaseType = Model<ClippingPlanesTraits>;

function ClippingPlanesMixin<T extends Constructor<BaseType>>(Base: T) {
  abstract class MixedClass extends Base {
    private clippingPlanesInteractonDisposer?: IReactionDisposer;
    private clippingPlanesController?: ClippingPlanesController;

    abstract modelBoundingSphere(): BoundingSphere | undefined;

    constructor(...args: any[]) {
      super(...args);

      onBecomeObserved(this, "clippingPlanesDataSource", () =>
        this.startClippingPlanesInteraction()
      );
      onBecomeUnobserved(this, "clippingPlanesDataSource", () =>
        this.stopClippingPlanesInteraction()
      );
    }

    private startClippingPlanesInteraction() {
      // Do nothing if the interaction is already active
      if (this.clippingPlanesInteractonDisposer) {
        return;
      }

      this.clippingPlanesInteractonDisposer = autorun(() => {
        this.clippingPlanesController?.destroy();
        this.clippingPlanesController = undefined;

        trace();
        const scene =
          this.terria.currentViewer instanceof Cesium
            ? this.terria.currentViewer.scene
            : undefined;

        if (
          !this.clippingPlanes.showEditorUi ||
          !this.clippingPlanes.enabled ||
          !this.clippingPlanesDataSource ||
          !scene
        ) {
          return;
        }

        this.clippingPlanesController = new ClippingPlanesController(
          this.clippingPlanesDataSource.entities,
          scene,
          this.handlePlaneInteractionEvent.bind(this)
        );
      });
    }

    @action
    private handlePlaneInteractionEvent(event: ClippingPlaneEvent) {
      const planeGraphics = event.entity.plane;
      const clippingPlane = planeGraphics?.plane?.getValue(JulianDate.now()) as
        | ClippingPlane
        | undefined;
      const index =
        this.clippingPlanesDataSource?.entities.values.findIndex(
          entity => entity === event.entity
        ) ?? -1;
      const clippingPlaneTrait =
        (index ?? -1) >= 0 ? this.clippingPlanes.planes[index] : undefined;

      if (!planeGraphics || !clippingPlane || !clippingPlaneTrait) {
        return undefined;
      }

      switch (event.event) {
        case "pick":
          this.resetPlaneGraphics(planeGraphics);
          planeGraphics.material = Color.WHITE.withAlpha(0.1) as any;
          planeGraphics.outlineColor = Color.CYAN as any;
          planeGraphics.outlineWidth = 5 as any;
          setCursor(this.terria, "grabbing");
          break;

        case "release":
          this.resetPlaneGraphics(planeGraphics);
          clippingPlaneTrait.setTrait(
            CommonStrata.user,
            "distance",
            clippingPlane.distance
          );
          setCursor(this.terria, "auto");
          break;

        case "move":
          const boundingSphereRadius =
            this.modelBoundingSphere()?.radius ?? Infinity;
          // Limit clipping plane offset to +/- bounding sphere radius
          clippingPlane.distance = CesiumMath.clamp(
            clippingPlane.distance + event.moveAmount,
            -boundingSphereRadius,
            boundingSphereRadius
          );
          break;

        case "mouseOver":
          this.resetPlaneGraphics(planeGraphics);
          planeGraphics.material = Color.CYAN.withAlpha(0.1) as any;
          planeGraphics.outlineColor = Color.CYAN as any;
          planeGraphics.outlineWidth = 5 as any;
          // cursor type "grab" doesn't work in chrome for some reason :(
          setCursor(this.terria, "pointer");
          break;

        case "mouseOut":
          this.resetPlaneGraphics(planeGraphics);
          break;
      }
    }

    private resetPlaneGraphics(planeGraphics: PlaneGraphics) {
      planeGraphics.material = Color.WHITE.withAlpha(0.1) as any;
      planeGraphics.outline = true as any;
      planeGraphics.outlineColor = Color.WHITE as any;
      planeGraphics.outlineWidth = 1 as any;
    }

    private stopClippingPlanesInteraction() {
      this.clippingPlanesController?.destroy();
      this.clippingPlanesInteractonDisposer?.();
      this.clippingPlanesController = undefined;
      this.clippingPlanesInteractonDisposer = undefined;
    }

    @computed
    get clippingPlaneCollection(): ClippingPlaneCollection | undefined {
      if (this.clippingPlanes.planes.length === 0) {
        return;
      }

      const {
        planes,
        enabled = true,
        unionClippingRegions = false,
        edgeColor,
        edgeWidth,
        modelMatrix
      } = this.clippingPlanes;

      const planesMapped = planes.map((plane: any) => {
        return new ClippingPlane(
          Cartesian3.fromArray(plane.normal || []),
          plane.distance
        );
      });

      let options = {
        planes: planesMapped,
        enabled,
        unionClippingRegions
      };

      if (edgeColor && edgeColor.length > 0) {
        options = Object.assign(options, {
          edgeColor: Color.fromCssColorString(edgeColor) || Color.WHITE
        });
      }

      if (edgeWidth && edgeWidth > 0) {
        options = Object.assign(options, { edgeWidth: edgeWidth });
      }

      if (modelMatrix && modelMatrix.length > 0) {
        const array = clone(toJS(modelMatrix));
        options = Object.assign(options, {
          modelMatrix: Matrix4.fromArray(array) || Matrix4.IDENTITY
        });
      }
      return new ClippingPlaneCollection(options);
    }

    @computed
    get clippingPlanesDataSource(): CustomDataSource | undefined {
      const modelBoundingSphere = this.modelBoundingSphere();
      if (
        !this.clippingPlanes.showEditorUi ||
        !this.clippingPlanes.enabled ||
        !this.clippingPlaneCollection ||
        this.clippingPlaneCollection.length === 0 ||
        !modelBoundingSphere
      ) {
        return undefined;
      }

      const startInteraction = () => this.startClippingPlanesInteraction();
      const stopInteraction = () => this.stopClippingPlanesInteraction();

      // Return a proxy of the datasource to interecept calls to show and start
      // or stop the user interaction
      const dataSource = new Proxy(new CustomDataSource(), {
        set: function(target, prop, value) {
          if (prop === "show") {
            value ? startInteraction() : stopInteraction();
          }
          return Reflect.set(target, prop, value);
        }
      });

      const { position, dimensions } = this.computePlanePositionAndDimensions(
        modelBoundingSphere,
        this.clippingPlaneCollection
      );

      for (let i = 0; i < this.clippingPlaneCollection.length; i++) {
        const clippingPlane = this.clippingPlaneCollection.get(i);
        const clippingPlaneEntity = dataSource.entities.add({
          position,
          plane: {
            plane: new CallbackProperty(() => clippingPlane, false),
            dimensions
          }
        });
        if (clippingPlaneEntity.plane) {
          this.resetPlaneGraphics(clippingPlaneEntity.plane);
        }
      }

      return dataSource;
    }

    private computePlanePositionAndDimensions(
      modelBoundingSphere: BoundingSphere,
      clippingPlaneCollection: ClippingPlaneCollection
    ): { position: any; dimensions: any } {
      const boundingSphere = BoundingSphere.transform(
        modelBoundingSphere,
        clippingPlaneCollection.modelMatrix,
        new BoundingSphere()
      );
      return {
        position: boundingSphere.center,
        dimensions: new Cartesian2(
          boundingSphere.radius * 2.25,
          boundingSphere.radius * 2.25
        )
      };
    }

    @computed
    get clippingPlanesDimension(): SelectableDimensionGroup | undefined {
      if (this.clippingPlanes.planes.length === 0) {
        return undefined;
      }

      return {
        type: "group",
        id: "clipping-planes",
        name: i18next.t("models.clippingPlanes.groupName"),
        selectableDimensions: [
          {
            id: "clipModel",
            type: "checkbox",
            selectedId: this.clippingPlanes.enabled ? "true" : "false",
            options: [
              {
                id: "true",
                name: i18next.t("models.clippingPlanes.options.clipModel")
              },
              {
                id: "false",
                name: i18next.t("models.clippingPlanes.options.clipModel")
              }
            ],
            setDimensionValue: (stratumId, value) => {
              this.clippingPlanes.setTrait(
                stratumId,
                "enabled",
                value === "true"
              );
            }
          },
          {
            id: "showEditorUi",
            type: "checkbox",
            disable: this.clippingPlanes.enabled === false,
            selectedId: this.clippingPlanes.showEditorUi ? "true" : "false",
            options: [
              {
                id: "true",
                name: i18next.t("models.clippingPlanes.options.edit")
              },
              {
                id: "false",
                name: i18next.t("models.clippingPlanes.options.edit")
              }
            ],
            setDimensionValue: (stratumId, value) => {
              this.clippingPlanes.setTrait(
                stratumId,
                "showEditorUi",
                value === "true"
              );
            }
          }
        ]
      };
    }
  }

  return MixedClass;
}

const rpRayScratch1 = new Ray();

function setCursor(terria: Terria, cursorType: string) {
  const scene =
    terria.currentViewer instanceof Cesium
      ? terria.currentViewer.scene
      : undefined;
  if (scene) {
    scene.canvas.style.cursor = cursorType;
  }
}

export default ClippingPlanesMixin;
