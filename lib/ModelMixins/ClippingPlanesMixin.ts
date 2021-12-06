import i18next from "i18next";
import throttle from "lodash-es/throttle";
import { computed, toJS } from "mobx";
import BoundingSphere from "terriajs-cesium/Source/Core/BoundingSphere";
import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import clone from "terriajs-cesium/Source/Core/clone";
import Color from "terriajs-cesium/Source/Core/Color";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import Matrix4 from "terriajs-cesium/Source/Core/Matrix4";
import ScreenSpaceEventHandler from "terriajs-cesium/Source/Core/ScreenSpaceEventHandler";
import ScreenSpaceEventType from "terriajs-cesium/Source/Core/ScreenSpaceEventType";
import BoxGraphics from "terriajs-cesium/Source/DataSources/BoxGraphics";
import CallbackProperty from "terriajs-cesium/Source/DataSources/CallbackProperty";
import CustomDataSource from "terriajs-cesium/Source/DataSources/CustomDataSource";
import Entity from "terriajs-cesium/Source/DataSources/Entity";
import PlaneGraphics from "terriajs-cesium/Source/DataSources/PlaneGraphics";
import ClippingPlane from "terriajs-cesium/Source/Scene/ClippingPlane";
import ClippingPlaneCollection from "terriajs-cesium/Source/Scene/ClippingPlaneCollection";
import Scene from "terriajs-cesium/Source/Scene/Scene";
import Constructor from "../Core/Constructor";
import ClippingBox from "../Models/ClippingBox";
import Model from "../Models/Definition/Model";
import { SelectableDimensionGroup } from "../Models/SelectableDimensions";
import Terria from "../Models/Terria";
import ClippingPlanesTraits, {
  ClippingPlaneCollectionTraits
} from "../Traits/TraitsClasses/ClippingPlanesTraits";

const cubeSide = 100;

type BaseType = Model<ClippingPlanesTraits>;

function ClippingPlanesMixin<T extends Constructor<BaseType>>(Base: T) {
  abstract class MixedClass extends Base {
    private eventHandler?: ScreenSpaceEventHandler;
    private boxPosition: Cartesian3 | undefined;
    abstract modelBoundingSphere(): BoundingSphere | undefined;
    abstract clippingPlanesOrigin: Cartesian3;
    abstract clippingPlanesOriginMatrix: Matrix4;

    startClippingPlanesInteraction() {}
    stopClippingPlanesInteraction() {}

    private resetPlaneGraphics(planeGraphics: PlaneGraphics) {
      planeGraphics.material = Color.WHITE.withAlpha(0.1) as any;
      planeGraphics.outline = true as any;
      planeGraphics.outlineColor = Color.WHITE as any;
      planeGraphics.outlineWidth = 1 as any;
    }

    @computed
    get clippingBox(): ClippingBox | undefined {
      const modelBoundingSphere = this.modelBoundingSphere();
      const scene = this.terria.cesium?.scene;
      if (scene && modelBoundingSphere) {
        const clippingBox = new ClippingBox(
          scene,
          this.clippingPlanesOriginMatrix,
          modelBoundingSphere.radius * 1.5
        );
        return clippingBox;
      }
    }

    @computed
    get clippingPlaneCollection(): ClippingPlaneCollection | undefined {
      return this.clippingBox?.clippingPlaneCollection;
      // const bs = this.modelBoundingSphere();
      // const boxDataSource = this.boxDataSource;
      // const boxEntity = boxDataSource?.entities.values.find(
      //   entity => entity.box
      // );
      // return bs && boxEntity
      //   ? clippingPlanesCollectionFromBox(
      //       bs.center,
      //       boxEntity.computeModelMatrix(JulianDate.now())
      //     )
      //   : this.clippingPlanes.planes.length > 0
      //   ? clippingPlanesCollectionFromPlanes(this.clippingPlanes)
      //   : undefined;
    }

    @computed
    get clippingPlanesDataSource(): CustomDataSource | undefined {
      return this.clippingBox?.dataSource;
      // const dataSource = this.boxDataSource ?? this.planesDataSource;
      // return dataSource;
    }

    @computed
    get boxDataSource(): CustomDataSource | undefined {
      const boundingSphere = this.modelBoundingSphere();
      if (!boundingSphere) {
        return;
      }
      const dataSource = new CustomDataSource();
      const boxPosition = boundingSphere.center.clone();
      this.boxPosition = boxPosition;
      dataSource.entities.add({
        position: new CallbackProperty(() => boxPosition, false) as any,
        box: {
          dimensions: new Cartesian3(cubeSide, cubeSide, cubeSide),
          fill: true,
          material: Color.WHITE.withAlpha(0.1),
          outline: true,
          outlineWidth: 3,
          outlineColor: Color.WHITE
        }
      });

      this.setupBoxEventHandler(dataSource);
      return dataSource;
    }

    setupBoxEventHandler(dataSource: CustomDataSource) {
      this.eventHandler?.destroy();
      const scene = this.terria.cesium?.scene;
      const boxEntity = dataSource.entities.values.find(
        entity => entity.box !== undefined
      );
      const box = boxEntity?.box;

      if (!scene || !boxEntity || !box) {
        return;
      }

      const highlightBox = (box: BoxGraphics) => {
        console.log("**highlight box**");
        box.outlineColor = Color.CYAN as any;
        setCanvasCursor(this.terria, "move");
      };

      const resetBox = (box: BoxGraphics) => {
        console.log("**reset box**");
        box.outlineColor = Color.WHITE as any;
        setCanvasCursor(this.terria, "auto");
      };

      const pickBox = (box: BoxGraphics) => {
        setCanvasCursor(this.terria, "grabbing");
      };

      const releaseBox = (box: BoxGraphics) => {
        console.log("**release box**");
        resetBox(box);
      };

      const moveBox = (
        boxEntity: Entity,
        box: BoxGraphics,
        startPosition: Cartesian3,
        currentPosition: Cartesian3
      ) => {
        if (!this.boxPosition) {
          return;
        }

        const moveAmount = Cartesian3.subtract(
          currentPosition,
          startPosition,
          new Cartesian3()
        );

        this.boxPosition = Cartesian3.add(
          this.boxPosition,
          moveAmount,
          this.boxPosition
        );

        if (this.clippingPlaneCollection) {
          this.clippingPlaneCollection.modelMatrix = boxEntity.computeModelMatrix(
            JulianDate.now(),
            this.clippingPlaneCollection.modelMatrix
          );
        }

        return currentPosition;
      };

      let isMouseOverBox = false;
      const mouseOverBox = throttle((position: Cartesian2) => {
        const picked = scene.pick(position);
        const pickedEntity = picked?.id;
        if (pickedEntity && pickedEntity.box === box) {
          if (!isMouseOverBox) {
            isMouseOverBox = true;
            highlightBox(box);
          }
        } else if (isMouseOverBox) {
          isMouseOverBox = false;
          resetBox(box);
        }
      }, 250);

      const eventHandler = new ScreenSpaceEventHandler(scene.canvas);
      let pickCursorPosition: Cartesian3 | undefined;
      eventHandler.setInputAction(({ position }) => {
        const picked = scene.pick(position);
        const pickedEntity = picked?.id;
        if (pickedEntity?.box !== box) {
          return;
        }

        pickCursorPosition = screenToCartesian3(position, scene);
        console.log("**pick box**", pickCursorPosition);
        if (pickCursorPosition) {
          pickBox(box);
          scene.screenSpaceCameraController.enableInputs = false;
        }
      }, ScreenSpaceEventType.LEFT_DOWN);

      eventHandler.setInputAction(({ position }) => {
        if (pickCursorPosition) {
          pickCursorPosition = undefined;
          releaseBox(box);
          scene.screenSpaceCameraController.enableInputs = true;
        }
      }, ScreenSpaceEventType.LEFT_UP);

      eventHandler.setInputAction(({ endPosition }) => {
        if (pickCursorPosition) {
          const currentPosition = screenToCartesian3(endPosition, scene);
          if (currentPosition) {
            pickCursorPosition = moveBox(
              boxEntity,
              box,
              pickCursorPosition,
              currentPosition
            );
          }
        } else {
          mouseOverBox(endPosition);
        }
      }, ScreenSpaceEventType.MOUSE_MOVE);
      this.eventHandler = eventHandler;
    }

    @computed
    get planesDataSource(): CustomDataSource | undefined {
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

      for (let i = 0; i < this.clippingPlaneCollection.length; i++) {
        const clippingPlane = this.clippingPlaneCollection.get(i);
        const clippingPlaneEntity = dataSource.entities.add({
          position: modelBoundingSphere.center.clone(),
          plane: {
            plane: new CallbackProperty(() => clippingPlane, false),
            dimensions: new Cartesian2(
              modelBoundingSphere.radius * 2.25,
              modelBoundingSphere.radius * 2.25
            )
          }
        });
        if (clippingPlaneEntity.plane) {
          this.resetPlaneGraphics(clippingPlaneEntity.plane);
        }
      }

      return dataSource;
    }

    @computed
    get clippingPlanesDimension(): SelectableDimensionGroup | undefined {
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

function setCanvasCursor(terria: Terria, cursorType: string) {
  const scene = terria.cesium?.scene;
  if (scene) {
    scene.canvas.style.cursor = cursorType;
  }
}

export function screenToCartesian3(
  position: Cartesian2,
  scene: Scene
): Cartesian3 | undefined {
  const pickRay = scene.camera.getPickRay(position);
  const cartesian3 = scene.globe.pick(pickRay, scene);
  return cartesian3;
}

function clippingPlanesCollectionFromBox(
  center: Cartesian3,
  modelMatrix: Matrix4
  //clippingPlanes: Model<ClippingPlaneCollectionTraits>
): ClippingPlaneCollection | undefined {
  const halfSide = cubeSide / 2;
  const clippingPlanes = [
    new ClippingPlane(new Cartesian3(0, 0, 1), halfSide),
    new ClippingPlane(new Cartesian3(0, 0, -1), halfSide),
    new ClippingPlane(new Cartesian3(0, 1, 0), halfSide),
    new ClippingPlane(new Cartesian3(0, -1, 0), halfSide),
    new ClippingPlane(new Cartesian3(1, 0, 0), halfSide),
    new ClippingPlane(new Cartesian3(-1, 0, 0), halfSide)
  ];

  return new ClippingPlaneCollection({
    enabled: true,
    unionClippingRegions: true,
    planes: clippingPlanes,
    modelMatrix
  });
}

function clippingPlanesCollectionFromPlanes(
  clippingPlanes: Model<ClippingPlaneCollectionTraits>
): ClippingPlaneCollection | undefined {
  if (clippingPlanes.planes.length === 0) {
    return;
  }

  const {
    planes,
    enabled = true,
    unionClippingRegions = false,
    edgeColor,
    edgeWidth,
    modelMatrix
  } = clippingPlanes;

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

export default ClippingPlanesMixin;

// import i18next from "i18next";
// import {
//   action,
//   autorun,
//   computed,
//   IReactionDisposer,
//   onBecomeObserved,
//   onBecomeUnobserved,
//   toJS
// } from "mobx";
// import BoundingSphere from "terriajs-cesium/Source/Core/BoundingSphere";
// import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
// import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
// import clone from "terriajs-cesium/Source/Core/clone";
// import Color from "terriajs-cesium/Source/Core/Color";
// import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
// import CesiumMath from "terriajs-cesium/Source/Core/Math";
// import Matrix4 from "terriajs-cesium/Source/Core/Matrix4";
// import CallbackProperty from "terriajs-cesium/Source/DataSources/CallbackProperty";
// import CustomDataSource from "terriajs-cesium/Source/DataSources/CustomDataSource";
// import PlaneGraphics from "terriajs-cesium/Source/DataSources/PlaneGraphics";
// import ClippingPlane from "terriajs-cesium/Source/Scene/ClippingPlane";
// import ClippingPlaneCollection from "terriajs-cesium/Source/Scene/ClippingPlaneCollection";
// import Constructor from "../Core/Constructor";
// import ClippingPlanesController, {
//   ClippingPlaneEvent
// } from "../Models/ClippingPlanesController";
// import CommonStrata from "../Models/Definition/CommonStrata";
// import Model from "../Models/Definition/Model";
// import { SelectableDimensionGroup } from "../Models/SelectableDimensions";
// import Terria from "../Models/Terria";
// import ClippingPlanesTraits from "../Traits/TraitsClasses/ClippingPlanesTraits";

// type BaseType = Model<ClippingPlanesTraits>;

// function ClippingPlanesMixin<T extends Constructor<BaseType>>(Base: T) {
//   abstract class MixedClass extends Base {
//     private clippingPlanesInteractonDisposer?: IReactionDisposer;
//     private clippingPlanesController?: ClippingPlanesController;

//     abstract modelBoundingSphere(): BoundingSphere | undefined;

//     constructor(...args: any[]) {
//       super(...args);

//       onBecomeObserved(this, "clippingPlanesDataSource", () =>
//         this.startClippingPlanesInteraction()
//       );
//       onBecomeUnobserved(this, "clippingPlanesDataSource", () =>
//         this.stopClippingPlanesInteraction()
//       );
//     }

//     private startClippingPlanesInteraction() {
//       // Do nothing if the interaction is already active
//       if (this.clippingPlanesInteractonDisposer) {
//         return;
//       }

//       this.clippingPlanesInteractonDisposer = autorun(() => {
//         this.clippingPlanesController?.destroy();
//         this.clippingPlanesController = undefined;

//         const scene = this.terria.cesium?.scene;

//         if (
//           !this.clippingPlanes.showEditorUi ||
//           !this.clippingPlanes.enabled ||
//           !this.clippingPlanesDataSource ||
//           !scene
//         ) {
//           return;
//         }

//         this.clippingPlanesController = new ClippingPlanesController(
//           this.clippingPlanesDataSource.entities,
//           scene,
//           this.handlePlaneInteractionEvent.bind(this)
//         );
//       });
//     }

//     @action
//     private handlePlaneInteractionEvent(event: ClippingPlaneEvent) {
//       const planeGraphics = event.entity.plane;
//       const clippingPlane = planeGraphics?.plane?.getValue(JulianDate.now()) as
//         | ClippingPlane
//         | undefined;
//       const index =
//         this.clippingPlanesDataSource?.entities.values.findIndex(
//           entity => entity === event.entity
//         ) ?? -1;
//       const clippingPlaneTrait =
//         (index ?? -1) >= 0 ? this.clippingPlanes.planes[index] : undefined;

//       if (!planeGraphics || !clippingPlane || !clippingPlaneTrait) {
//         return undefined;
//       }

//       switch (event.event) {
//         case "pick":
//           this.resetPlaneGraphics(planeGraphics);
//           planeGraphics.material = Color.WHITE.withAlpha(0.1) as any;
//           planeGraphics.outlineColor = Color.CYAN as any;
//           planeGraphics.outlineWidth = 5 as any;
//           setCanvasCursor(this.terria, "grabbing");
//           break;

//         case "release":
//           this.resetPlaneGraphics(planeGraphics);
//           clippingPlaneTrait.setTrait(
//             CommonStrata.user,
//             "distance",
//             clippingPlane.distance
//           );
//           setCanvasCursor(this.terria, "auto");
//           break;

//         case "move":
//           const boundingSphereRadius =
//             this.modelBoundingSphere()?.radius ?? Infinity;
//           // Limit clipping plane offset to +/- bounding sphere radius
//           clippingPlane.distance = CesiumMath.clamp(
//             clippingPlane.distance + event.moveAmount,
//             -boundingSphereRadius,
//             boundingSphereRadius
//           );
//           break;

//         case "mouseOver":
//           this.resetPlaneGraphics(planeGraphics);
//           planeGraphics.material = Color.CYAN.withAlpha(0.1) as any;
//           planeGraphics.outlineColor = Color.CYAN as any;
//           planeGraphics.outlineWidth = 5 as any;
//           // cursor type "grab" doesn't work in chrome for some reason :(
//           setCanvasCursor(this.terria, "pointer");
//           break;

//         case "mouseOut":
//           this.resetPlaneGraphics(planeGraphics);
//           setCanvasCursor(this.terria, "auto");
//           break;
//       }
//     }

//     private resetPlaneGraphics(planeGraphics: PlaneGraphics) {
//       planeGraphics.material = Color.WHITE.withAlpha(0.1) as any;
//       planeGraphics.outline = true as any;
//       planeGraphics.outlineColor = Color.WHITE as any;
//       planeGraphics.outlineWidth = 1 as any;
//     }

//     private stopClippingPlanesInteraction() {
//       this.clippingPlanesController?.destroy();
//       this.clippingPlanesInteractonDisposer?.();
//       this.clippingPlanesController = undefined;
//       this.clippingPlanesInteractonDisposer = undefined;
//     }

//     @computed
//     get clippingPlaneCollection(): ClippingPlaneCollection | undefined {
//       if (this.clippingPlanes.planes.length === 0) {
//         return;
//       }

//       const {
//         planes,
//         enabled = true,
//         unionClippingRegions = false,
//         edgeColor,
//         edgeWidth,
//         modelMatrix
//       } = this.clippingPlanes;

//       const planesMapped = planes.map((plane: any) => {
//         return new ClippingPlane(
//           Cartesian3.fromArray(plane.normal || []),
//           plane.distance
//         );
//       });

//       let options = {
//         planes: planesMapped,
//         enabled,
//         unionClippingRegions
//       };

//       if (edgeColor && edgeColor.length > 0) {
//         options = Object.assign(options, {
//           edgeColor: Color.fromCssColorString(edgeColor) || Color.WHITE
//         });
//       }

//       if (edgeWidth && edgeWidth > 0) {
//         options = Object.assign(options, { edgeWidth: edgeWidth });
//       }

//       if (modelMatrix && modelMatrix.length > 0) {
//         const array = clone(toJS(modelMatrix));
//         options = Object.assign(options, {
//           modelMatrix: Matrix4.fromArray(array) || Matrix4.IDENTITY
//         });
//       }
//       return new ClippingPlaneCollection(options);
//     }

//     @computed
//     get clippingPlanesDataSource(): CustomDataSource | undefined {
//       const modelBoundingSphere = this.modelBoundingSphere();
//       if (
//         !this.clippingPlanes.showEditorUi ||
//         !this.clippingPlanes.enabled ||
//         !this.clippingPlaneCollection ||
//         this.clippingPlaneCollection.length === 0 ||
//         !modelBoundingSphere
//       ) {
//         return undefined;
//       }

//       const startInteraction = () => this.startClippingPlanesInteraction();
//       const stopInteraction = () => this.stopClippingPlanesInteraction();

//       // Return a proxy of the datasource to interecept calls to show and start
//       // or stop the user interaction
//       const dataSource = new Proxy(new CustomDataSource(), {
//         set: function(target, prop, value) {
//           if (prop === "show") {
//             value ? startInteraction() : stopInteraction();
//           }
//           return Reflect.set(target, prop, value);
//         }
//       });

//       const { position, dimensions } = this.computePlanePositionAndDimensions(
//         modelBoundingSphere,
//         this.clippingPlaneCollection
//       );

//       for (let i = 0; i < this.clippingPlaneCollection.length; i++) {
//         const clippingPlane = this.clippingPlaneCollection.get(i);
//         const clippingPlaneEntity = dataSource.entities.add({
//           position,
//           plane: {
//             plane: new CallbackProperty(() => clippingPlane, false),
//             dimensions
//           }
//         });
//         if (clippingPlaneEntity.plane) {
//           this.resetPlaneGraphics(clippingPlaneEntity.plane);
//         }
//       }

//       return dataSource;
//     }

//     private computePlanePositionAndDimensions(
//       modelBoundingSphere: BoundingSphere,
//       clippingPlaneCollection: ClippingPlaneCollection
//     ): { position: any; dimensions: any } {
//       const boundingSphere = BoundingSphere.transform(
//         modelBoundingSphere,
//         clippingPlaneCollection.modelMatrix,
//         new BoundingSphere()
//       );
//       return {
//         position: boundingSphere.center,
//         dimensions: new Cartesian2(
//           boundingSphere.radius * 2.25,
//           boundingSphere.radius * 2.25
//         )
//       };
//     }

//     @computed
//     get clippingPlanesDimension(): SelectableDimensionGroup | undefined {
//       if (this.clippingPlanes.planes.length === 0) {
//         return undefined;
//       }

//       return {
//         type: "group",
//         id: "clipping-planes",
//         name: i18next.t("models.clippingPlanes.groupName"),
//         selectableDimensions: [
//           {
//             id: "clipModel",
//             type: "checkbox",
//             selectedId: this.clippingPlanes.enabled ? "true" : "false",
//             options: [
//               {
//                 id: "true",
//                 name: i18next.t("models.clippingPlanes.options.clipModel")
//               },
//               {
//                 id: "false",
//                 name: i18next.t("models.clippingPlanes.options.clipModel")
//               }
//             ],
//             setDimensionValue: (stratumId, value) => {
//               this.clippingPlanes.setTrait(
//                 stratumId,
//                 "enabled",
//                 value === "true"
//               );
//             }
//           },
//           {
//             id: "showEditorUi",
//             type: "checkbox",
//             disable: this.clippingPlanes.enabled === false,
//             selectedId: this.clippingPlanes.showEditorUi ? "true" : "false",
//             options: [
//               {
//                 id: "true",
//                 name: i18next.t("models.clippingPlanes.options.edit")
//               },
//               {
//                 id: "false",
//                 name: i18next.t("models.clippingPlanes.options.edit")
//               }
//             ],
//             setDimensionValue: (stratumId, value) => {
//               this.clippingPlanes.setTrait(
//                 stratumId,
//                 "showEditorUi",
//                 value === "true"
//               );
//             }
//           }
//         ]
//       };
//     }
//   }

//   return MixedClass;
// }

// function setCanvasCursor(terria: Terria, cursorType: string) {
//   const scene = terria.cesium?.scene;
//   if (scene) {
//     scene.canvas.style.cursor = cursorType;
//   }
// }

// export default ClippingPlanesMixin;
