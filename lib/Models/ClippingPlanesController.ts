import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import Matrix4 from "terriajs-cesium/Source/Core/Matrix4";
import Ray from "terriajs-cesium/Source/Core/Ray";
import ScreenSpaceEventHandler from "terriajs-cesium/Source/Core/ScreenSpaceEventHandler";
import ScreenSpaceEventType from "terriajs-cesium/Source/Core/ScreenSpaceEventType";
import Transforms from "terriajs-cesium/Source/Core/Transforms";
import Entity from "terriajs-cesium/Source/DataSources/Entity";
import EntityCollection from "terriajs-cesium/Source/DataSources/EntityCollection";
import PlaneGraphics from "terriajs-cesium/Source/DataSources/PlaneGraphics";
import PositionProperty from "terriajs-cesium/Source/DataSources/PositionProperty";
import Property from "terriajs-cesium/Source/DataSources/Property";
import ClippingPlane from "terriajs-cesium/Source/Scene/ClippingPlane";
import Scene from "terriajs-cesium/Source/Scene/Scene";

export type PlaneEntity = Entity & {
  position: PositionProperty;
  plane: PlaneGraphics & { plane: Property };
};

export type ClippingPlaneEvent =
  | { event: "pick"; entity: PlaneEntity }
  | { event: "release"; entity: PlaneEntity }
  | { event: "mouseOver"; entity: PlaneEntity }
  | { event: "mouseOut"; entity: PlaneEntity }
  | { event: "move"; entity: PlaneEntity; moveAmount: number };

type State =
  | { is: "picked"; pickedEntity: PlaneEntity }
  | { is: "mouseOver"; mouseOverEntity: PlaneEntity }
  | { is: "none" };

type MouseClick = { position: Cartesian2 };
type MouseMovement = { startPosition: Cartesian2; endPosition: Cartesian2 };

export default class ClippingPlanesController {
  private eventHandler: ScreenSpaceEventHandler;
  private state: State = { is: "none" };
  constructor(
    readonly planeEntities: EntityCollection,
    readonly scene: Scene,
    readonly callback: (event: ClippingPlaneEvent) => void
  ) {
    this.eventHandler = new ScreenSpaceEventHandler(scene.canvas);
    this.setupInteractions();
  }

  setupInteractions() {
    this.eventHandler.setInputAction(
      this.handleMousePick.bind(this),
      ScreenSpaceEventType.LEFT_DOWN
    );

    this.eventHandler.setInputAction(
      this.handleMouseMove.bind(this),
      ScreenSpaceEventType.MOUSE_MOVE
    );

    this.eventHandler.setInputAction(
      this.handleMouseRelease.bind(this),
      ScreenSpaceEventType.LEFT_UP
    );

    this.scene.canvas.addEventListener("mouseout", this.handleCanvasMouseOut);
  }

  handleMousePick({ position }: MouseClick) {
    const pickedEntity = this.pickPlaneEntityAtPosition(position);
    if (!pickedEntity) {
      return;
    }

    if (this.state.is === "picked") {
      // nothing to do if the entity is already picked (which is very unlikely
      // to happen)
      if (this.state.pickedEntity === pickedEntity) {
        return;
      } else {
        this.callback({ event: "release", entity: this.state.pickedEntity });
      }
    }

    this.scene.screenSpaceCameraController.enableInputs = false;
    this.state = { is: "picked", pickedEntity };
    this.callback({ event: "pick", entity: pickedEntity });
  }

  handleMouseRelease({ position }: MouseClick) {
    if (this.state.is === "picked") {
      const pickedEntity = this.state.pickedEntity;
      this.scene.screenSpaceCameraController.enableInputs = true;
      this.state = { is: "none" };
      this.callback({ event: "release", entity: pickedEntity });
    }
  }

  handleMouseMove(movement: MouseMovement) {
    if (this.state.is === "picked") {
      // Move the picked plane entity
      this.movePlaneEntity(this.state.pickedEntity, movement);
    } else {
      // 1. Fire mouseOut event if the cursor is out of a pickable plane or over a new one.
      // 2. Fire mouseOver event if the cursor is over a new pickable plane.
      const pickableEntity = this.pickPlaneEntityAtPosition(
        movement.endPosition
      );
      if (
        this.state.is === "mouseOver" &&
        pickableEntity !== this.state.mouseOverEntity
      ) {
        const mouseOverEntity = this.state.mouseOverEntity;
        this.state = { is: "none" };
        this.callback({ event: "mouseOut", entity: mouseOverEntity });
      }

      if (!pickableEntity) {
        return;
      }

      if (
        this.state.is === "none" ||
        (this.state.is === "mouseOver" &&
          pickableEntity !== this.state.mouseOverEntity)
      ) {
        this.state = { is: "mouseOver", mouseOverEntity: pickableEntity };
        this.callback({
          event: "mouseOver",
          entity: this.state.mouseOverEntity
        });
      }
    }
  }

  // Defined as property to make it easier to pass to add/removeEventListener.
  handleCanvasMouseOut = () => {
    if (this.state.is === "mouseOver") {
      const mouseOverEntity = this.state.mouseOverEntity;
      this.state = { is: "none" };
      this.callback({ event: "mouseOut", entity: mouseOverEntity });
    }
  };

  movePlaneEntity(pickedEntity: PlaneEntity, movement: MouseMovement) {
    const clippingPlane = pickedEntity.plane.plane.getValue(
      JulianDate.now()
    ) as ClippingPlane | undefined;
    const planePosition = pickedEntity.position.getValue(JulianDate.now()) as
      | Cartesian3
      | undefined;
    if (clippingPlane && planePosition) {
      const moveAmount = this.computeMoveAmount(
        clippingPlane,
        planePosition,
        movement
      );
      this.callback({ event: "move", entity: pickedEntity, moveAmount });
    }
  }

  pickPlaneEntityAtPosition(position: Cartesian2): PlaneEntity | undefined {
    const picked = this.scene.pick(position);
    const pickedEntity = picked?.id;
    const pickedPlane = pickedEntity?.plane;
    const isPickablePlane =
      pickedPlane &&
      this.planeEntities.values.some(entity => entity.plane === pickedPlane) &&
      pickedEntity.position;
    if (pickedEntity && isPickablePlane) {
      return pickedEntity;
    }
  }

  computeMoveAmount(
    clippingPlane: ClippingPlane,
    planePosition: Cartesian3,
    movement: MouseMovement
  ): number {
    const mouseMoveVector2d = Cartesian2.subtract(
      movement.startPosition,
      movement.endPosition,
      cmCartesian2Scratch1
    );
    const planeVector2d = screenProjectPlaneNormal(
      this.scene,
      clippingPlane,
      planePosition,
      cmCartesian2Scratch2
    );
    const moveAmount = planeVector2d
      ? Cartesian2.dot(mouseMoveVector2d, planeVector2d)
      : 0;
    return moveAmount;
  }

  destroy() {
    this.eventHandler.destroy();
    this.scene.canvas.removeEventListener(
      "mouseout",
      this.handleCanvasMouseOut
    );
  }
}

const cmCartesian2Scratch1 = new Cartesian2();
const cmCartesian2Scratch2 = new Cartesian2();

const spCartesian3Scratch1 = new Cartesian3();
const spCartesian3Scratch2 = new Cartesian3();
const spCartesian2Scratch1 = new Cartesian2();
const spCartesian2Scratch2 = new Cartesian2();

const spRayScratch1 = new Ray();

function screenProjectPlaneNormal(
  scene: Scene,
  plane: ClippingPlane,
  planePosition: Cartesian3,
  result: Cartesian2
): Cartesian2 | undefined {
  const planeRay = getPlaneRay(plane, planePosition, spRayScratch1);
  // Screen projection point on the plane
  const nearPoint2d = scene.cartesianToCanvasCoordinates(
    Ray.getPoint(planeRay, 0, spCartesian3Scratch1),
    spCartesian2Scratch1
  );

  // Screen projection point on the plane normal at planePosition
  const farPoint2d = scene.cartesianToCanvasCoordinates(
    Ray.getPoint(planeRay, 1, spCartesian3Scratch2),
    spCartesian2Scratch2
  );

  if (nearPoint2d === undefined || farPoint2d === undefined) {
    return undefined;
  }

  const planeVector2d = Cartesian2.normalize(
    Cartesian2.subtract(farPoint2d, nearPoint2d, result),
    result
  );
  return planeVector2d;
}

const prMatrix4Scratch1 = new Matrix4();
const prCartesian3Scratch1 = new Cartesian3();
const prCartesian3Scratch2 = new Cartesian3();

export function getPlaneRay(
  plane: ClippingPlane,
  planePosition: Cartesian3,
  result: Ray
) {
  const ecefTransform = Transforms.eastNorthUpToFixedFrame(
    planePosition,
    undefined,
    prMatrix4Scratch1
  );

  const ecefPlaneNormal = Cartesian3.normalize(
    Matrix4.multiplyByPointAsVector(
      ecefTransform,
      plane.normal,
      prCartesian3Scratch1
    ),
    prCartesian3Scratch1
  );

  const pointOnPlane = Cartesian3.add(
    planePosition,
    Cartesian3.multiplyByScalar(
      ecefPlaneNormal,
      -plane.distance,
      prCartesian3Scratch2
    ),
    prCartesian3Scratch2
  );

  const planeRay = Ray.clone(new Ray(pointOnPlane, ecefPlaneNormal), result);
  return planeRay;
}
