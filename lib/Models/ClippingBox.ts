import throttle from "lodash-es/throttle";
import { computed } from "mobx";
import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Color from "terriajs-cesium/Source/Core/Color";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import CesiumMath from "terriajs-cesium/Source/Core/Math";
import Matrix4 from "terriajs-cesium/Source/Core/Matrix4";
import Plane from "terriajs-cesium/Source/Core/Plane";
import Ray from "terriajs-cesium/Source/Core/Ray";
import ScreenSpaceEventHandler from "terriajs-cesium/Source/Core/ScreenSpaceEventHandler";
import ScreenSpaceEventType from "terriajs-cesium/Source/Core/ScreenSpaceEventType";
import Transforms from "terriajs-cesium/Source/Core/Transforms";
import CallbackProperty from "terriajs-cesium/Source/DataSources/CallbackProperty";
import CustomDataSource from "terriajs-cesium/Source/DataSources/CustomDataSource";
import Entity from "terriajs-cesium/Source/DataSources/Entity";
import PlaneGraphics from "terriajs-cesium/Source/DataSources/PlaneGraphics";
import PointGraphics from "terriajs-cesium/Source/DataSources/PointGraphics";
import PositionProperty from "terriajs-cesium/Source/DataSources/PositionProperty";
import Property from "terriajs-cesium/Source/DataSources/Property";
import Axis from "terriajs-cesium/Source/Scene/Axis";
import ClippingPlane from "terriajs-cesium/Source/Scene/ClippingPlane";
import ClippingPlaneCollection from "terriajs-cesium/Source/Scene/ClippingPlaneCollection";
import Scene from "terriajs-cesium/Source/Scene/Scene";

type MouseClick = { position: Cartesian2 };
type MouseMovement = { startPosition: Cartesian2; endPosition: Cartesian2 };

export type PlaneEntity = Entity & {
  position: PositionProperty;
  plane: PlaneGraphics & { plane: Property };
};

export type PointEntity = Entity & {
  position: PositionProperty;
  point: PointGraphics;
};

export default class ClippingBox {
  modelMatrix: Matrix4;
  planeEventHandler?: ScreenSpaceEventHandler;
  pointEventHandler?: ScreenSpaceEventHandler;

  constructor(
    readonly scene: Scene,
    readonly clippingPlanesOriginMatrix: Matrix4,
    size: number
  ) {
    this.modelMatrix = Matrix4.fromScale(
      new Cartesian3(size / 3, size / 2, size),
      //new Cartesian3(32, 64, 128),
      new Matrix4()
    );
  }

  getPlaneDimensions(plane: Plane, result: Cartesian2) {
    const boxDimensions = this.boxDimensions;
    const normalAxis = getPlaneNormalAxis(plane);
    if (normalAxis === Axis.X) {
      result.x = boxDimensions.y;
      result.y = boxDimensions.z;
    } else if (normalAxis === Axis.Y) {
      result.x = boxDimensions.x;
      result.y = boxDimensions.z;
    } else if (normalAxis === Axis.Z) {
      result.x = boxDimensions.x;
      result.y = boxDimensions.y;
    }
    return result;
  }

  get boxDimensions(): Cartesian3 {
    return Matrix4.getScale(this.modelMatrix, new Cartesian3());
  }

  get boxPosition() {
    const position = Matrix4.getTranslation(
      Matrix4.multiply(
        this.clippingPlanesOriginMatrix,
        this.modelMatrix,
        new Matrix4()
      ),
      new Cartesian3()
    );
    return position;
  }

  setupPlaneEventHandler(
    eventHandler: ScreenSpaceEventHandler,
    planeEntities: PlaneEntity[]
  ) {
    const highlightBox = () => {
      planeEntities.forEach(entity => {
        if (entity.plane) {
          entity.plane.material = Color.CYAN.withAlpha(0.1) as any;
          entity.plane.outlineColor = Color.CYAN as any;
        }
      });
    };

    const resetBox = () => {
      planeEntities.forEach(entity => {
        if (entity.plane) {
          entity.plane.material = Color.WHITE.withAlpha(0.1) as any;
          entity.plane.outlineColor = Color.WHITE as any;
        }
      });
    };

    const scene = this.scene;
    let pickedPlaneEntity: PlaneEntity | undefined;
    let moveStart: Cartesian2 | undefined;
    let mouseOverBox = false;

    const pickBox = ({ position }: MouseClick) => {
      const pickedEntity = scene.pick(position)?.id;
      if (!pickedEntity || !planeEntities.includes(pickedEntity)) {
        return;
      }
      scene.screenSpaceCameraController.enableInputs = false;
      pickedPlaneEntity = pickedEntity;
      moveStart = position.clone();
      highlightBox();
      setCanvasCursor(scene, "grabbing");
    };

    const releaseBox = () => {
      resetBox();
      pickedPlaneEntity = undefined;
      mouseOverBox = false;
      moveStart = undefined;
      scene.screenSpaceCameraController.enableInputs = true;
      setCanvasCursor(scene, "auto");
    };

    const moveBox = (
      pickedSide: PlaneEntity,
      movement: MouseMovement,
      moveStart: Cartesian2
    ) => {
      const plane = pickedSide.plane.plane.getValue(JulianDate.now());
      const moveUpDown = getPlaneNormalAxis(plane) === Axis.Z;
      const planePosition = pickedSide.position.getValue(JulianDate.now());
      let translation = new Cartesian3();
      if (moveUpDown) {
        const moveAmount = computeMoveAmount(
          scene,
          plane,
          planePosition,
          movement,
          this.boxDimensions.z
        );
        translation = Cartesian3.multiplyByScalar(
          plane.normal,
          -moveAmount,
          translation
        );
      } else {
        const previousPosition = screenToCartesian3(moveStart, scene);
        const newPosition = screenToCartesian3(movement.endPosition, scene);
        if (previousPosition && newPosition) {
          const inverseEcef = Matrix4.inverseTransformation(
            Transforms.eastNorthUpToFixedFrame(
              this.boxPosition,
              undefined,
              new Matrix4()
            ),
            new Matrix4()
          );
          const localNew = Matrix4.multiplyByPoint(
            inverseEcef,
            newPosition,
            new Cartesian3()
          );
          const localPrevious = Matrix4.multiplyByPoint(
            inverseEcef,
            previousPosition,
            new Cartesian3()
          );
          translation = Cartesian3.subtract(
            localNew,
            localPrevious,
            translation
          );
          translation.z = 0;
        }
      }
      Matrix4.multiply(
        Matrix4.fromTranslation(translation, new Matrix4()),
        this.modelMatrix,
        this.modelMatrix
      );
    };

    const hoverBox = throttle((movement: MouseMovement) => {
      const pickedEntity = scene.pick(movement.endPosition)?.id;
      const isHoveringPlane =
        pickedEntity && planeEntities.includes(pickedEntity);

      if (isHoveringPlane) {
        if (!mouseOverBox) {
          highlightBox();
          setCanvasCursor(scene, "move");
          mouseOverBox = true;
        }
      } else if (mouseOverBox) {
        resetBox();
        setCanvasCursor(scene, "auto");
        mouseOverBox = false;
      }
    }, 0);

    const onMouseMove = (movement: MouseMovement) => {
      if (pickedPlaneEntity && moveStart) {
        moveBox(pickedPlaneEntity, movement, moveStart);
        moveStart = movement.endPosition.clone();
      } else {
        hoverBox(movement);
      }
    };

    eventHandler.setInputAction(pickBox, ScreenSpaceEventType.LEFT_DOWN);
    eventHandler.setInputAction(releaseBox, ScreenSpaceEventType.LEFT_UP);
    eventHandler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE);
  }

  setupPointEventHandler(
    eventHandler: ScreenSpaceEventHandler,
    pointEntities: PointEntity[]
  ) {
    const scene = this.scene;
    let pickedPoint: PointEntity | undefined;
    let moveStart: Cartesian2 | undefined;
    const pickPoint = ({ position }: MouseClick) => {
      const pickedEntity: PointEntity | undefined = scene.pick(position)?.id;
      if (!pickedEntity || !pointEntities.includes(pickedEntity)) {
        return;
      }

      pickedPoint = pickedEntity;
      pickedPoint.properties?.getValue(JulianDate.now())?.highlight();
      moveStart = position.clone();
      scene.screenSpaceCameraController.enableInputs = false;
    };
    const releasePoint = () => {
      if (pickedPoint) {
        pickedPoint.properties?.getValue(JulianDate.now())?.resetStyle();
      }
      pickedPoint = undefined;
      moveStart = undefined;
      scene.screenSpaceCameraController.enableInputs = true;
    };

    // const scaleBox = (
    //   pickedPoint: PointEntity,
    //   previousCursor: Cartesian2,
    //   newCursor: Cartesian2
    // ) => {
    //   const adjacentPlanes: PlaneGraphics[] = pickedPoint.properties?.getValue(
    //     JulianDate.now()
    //   ).adjacentPlanes;
    //   const previousPosition = screenToCartesian3(previousCursor, scene);
    //   const newPosition = screenToCartesian3(newCursor, scene);
    //   if (!previousPosition || !newPosition) {
    //     return;
    //   }
    //   const inverseEcef = Matrix4.inverseTransformation(
    //     Transforms.eastNorthUpToFixedFrame(
    //       this.boxPosition,
    //       undefined,
    //       new Matrix4()
    //     ),
    //     new Matrix4()
    //   );
    //   const localNew = Matrix4.multiplyByPoint(
    //     inverseEcef,
    //     newPosition,
    //     new Cartesian3()
    //   );
    //   const localPrevious = Matrix4.multiplyByPoint(
    //     inverseEcef,
    //     previousPosition,
    //     new Cartesian3()
    //   );
    //   const moveVector = Cartesian3.subtract(
    //     localPrevious,
    //     localNew,
    //     new Cartesian3()
    //   );

    //   const scale = Cartesian3.fromArray(
    //     adjacentPlanes.map(plane => {
    //       const normal = plane.plane?.getValue(JulianDate.now()).normal;
    //       return Cartesian3.dot(moveVector, normal);
    //     })
    //   );
    //   Matrix4.setScale(
    //     this.modelMatrix,
    //     Cartesian3.add(
    //       scale,
    //       Matrix4.getScale(this.modelMatrix, new Cartesian3()),
    //       new Cartesian3()
    //     ),
    //     this.modelMatrix
    //   );
    //   console.log(moveVector, scale);
    // };

    const scaleBox = (
      pickedPoint: PointEntity,
      previousCursor: Cartesian2,
      newCursor: Cartesian2
    ) => {
      const adjacentPlanes: PlaneGraphics[] = pickedPoint.properties?.getValue(
        JulianDate.now()
      ).adjacentPlanes;

      const translation: number[] = [];

      // const [d1, d2, d3] = adjacentPlanes.map((planeGraphics, i) => {
      //   const plane: Plane = planeGraphics.plane?.getValue(JulianDate.now());
      //   const axisDimension =
      //     i === 0
      //       ? this.boxDimensions.x
      //       : i === 1
      //       ? this.boxDimensions.y
      //       : this.boxDimensions.z;

      //   const ray = getPlaneRay(plane, this.boxPosition, new Ray());
      //   const pixelDiff = Cartesian2.subtract(
      //     scene.cartesianToCanvasCoordinates(Ray.getPoint(ray, axisDimension)),
      //     scene.cartesianToCanvasCoordinates(Ray.getPoint(ray, 0)),
      //     new Cartesian2()
      //   );
      //   return pixelDiff;
      // });

      // const pixelDiff = new Cartesian2(
      //   Math.max(d1.x, d2.x, d3.x),
      //   Math.max(d1.y, d2.y, d3.y)
      // );

      // const pixelDim = Cartesian2.magnitude(pixelDiff);

      const scale = Cartesian3.fromArray(
        adjacentPlanes.map((planeGraphics, i) => {
          const plane: Plane = planeGraphics.plane?.getValue(JulianDate.now());
          const axisDimension =
            i === 0
              ? this.boxDimensions.x
              : i === 1
              ? this.boxDimensions.y
              : this.boxDimensions.z;
          let moveAmount = computeMoveAmount(
            scene,
            plane,
            this.boxPosition,
            {
              startPosition: previousCursor,
              endPosition: newCursor
            },
            axisDimension
          );

          const ray = getPlaneRay(plane, this.boxPosition, new Ray());
          const pixelDiff = Cartesian2.subtract(
            scene.cartesianToCanvasCoordinates(
              Ray.getPoint(ray, axisDimension)
            ),
            scene.cartesianToCanvasCoordinates(Ray.getPoint(ray, 0)),
            new Cartesian2()
          );
          const pixelDim = Cartesian2.magnitude(pixelDiff);
          // console.log(
          //   axisDimension,
          //   pixelDim,
          //   moveAmount,
          //   moveAmount * (axisDimension / pixelDim)
          // );
          // console.log(
          //   i,
          //   axisDimension,
          //   pixelDim,
          //   axisDimension / pixelDim,
          //   moveAmount,
          //   Cartesian2.magnitude(
          //     screenProjectPlaneNormal(
          //       scene,
          //       plane,
          //       this.boxPosition,
          //       axisDimension,
          //       new Cartesian2()
          //     )!
          //   )
          // );
          //moveAmount = moveAmount * (axisDimension / pixelDim);

          //const multiplier = scene.cartesianToCanvasCoordinates(axisDimension);
          //console.log(moveAmount, Math.log(multiplier));
          //moveAmount *= 2; //Math.log(multiplier);
          // if (i === 2) {
          //   console.log(
          //     moveAmount,
          //     Cartesian2.subtract(newCursor, previousCursor, new Cartesian2()),
          //     axisDimension,
          //     computeMoveAmount(scene, plane, this.boxPosition, {
          //       startPosition: new Cartesian2(0, 0),
          //       endPosition: new Cartesian2(0, 100)
          //     })
          //   );
          // }
          const translateAmount =
            i === 0
              ? plane.normal.x * moveAmount
              : i === 1
              ? plane.normal.y * moveAmount
              : plane.normal.z * moveAmount;
          translation.push((-1 * translateAmount) / 2);
          return moveAmount;
        })
      );

      Matrix4.setScale(
        this.modelMatrix,
        Cartesian3.add(
          scale,
          Matrix4.getScale(this.modelMatrix, new Cartesian3()),
          new Cartesian3()
        ),
        this.modelMatrix
      );

      // console.log(Matrix4.fromScale(scale, new Matrix4()));
      // console.log(scale, Matrix4.getScale(this.modelMatrix, new Cartesian3()));
      // Matrix4.multiply(
      //   this.modelMatrix,
      //   Matrix4.fromScale(scale, new Matrix4()),
      //   this.modelMatrix
      // );

      // console.log(
      //   scale,
      //   Matrix4.getScale(this.modelMatrix, new Cartesian3())
      //   // this.modelMatrix,
      //   // this.clippingPlanesOriginMatrix,
      //   // Matrix4.multiply(
      //   //   this.clippingPlanesOriginMatrix,
      //   //   this.modelMatrix,
      //   //   new Matrix4()
      //   // ),
      //   // adjacentPlanes[2].plane?.getValue(JulianDate.now()).normal.z
      // );

      const translate = Cartesian3.fromArray(translation);
      // const translate = Cartesian3.multiplyByScalar(
      //   scale,
      //   0.5,
      //   new Cartesian3()
      // );
      // translate.z =
      //   adjacentPlanes[2].plane?.getValue(JulianDate.now()).normal.z *
      //   translate.z;
      Matrix4.multiply(
        Matrix4.fromTranslation(translate, new Matrix4()),
        this.modelMatrix,
        this.modelMatrix
      );

      // Matrix4.setTranslation(
      //   this.modelMatrix,
      //   Cartesian3.add(
      //     Matrix4.getTranslation(this.modelMatrix, new Cartesian3()),
      //     Cartesian3.multiplyByScalar(scale, -1, new Cartesian3()),
      //     new Cartesian3()
      //   ),
      //   this.modelMatrix
      // );
    };

    const onMouseMove = (movement: MouseMovement) => {
      if (pickedPoint && moveStart) {
        scaleBox(pickedPoint, moveStart, movement.endPosition.clone());
        moveStart = movement.endPosition.clone();
      } else {
      }
    };

    eventHandler.setInputAction(pickPoint, ScreenSpaceEventType.LEFT_DOWN);
    eventHandler.setInputAction(releasePoint, ScreenSpaceEventType.LEFT_UP);
    eventHandler.setInputAction(onMouseMove, ScreenSpaceEventType.MOUSE_MOVE);
  }

  @computed
  get dataSource(): CustomDataSource {
    const dataSource = new CustomDataSource();
    const planeEntities: PlaneEntity[] = [];
    this.clippingPlanes.forEach(plane => {
      const entity = dataSource.entities.add({
        position: new CallbackProperty(() => this.boxPosition, false) as any,
        //position: new CallbackProperty(() => this.boxPosition, false) as any,
        // position: new CallbackProperty(
        //   () =>
        //     Matrix4.getTranslation(
        //       this.clippingPlanesOriginMatrix,
        //       new Cartesian3()
        //     ),
        //   false
        // ) as any,
        plane: {
          plane: new CallbackProperty(() => {
            const transformedPlane = Plane.transform(
              plane,
              // this.modelMatrix,
              // Matrix4.multiply(
              //   this.clippingPlanesOriginMatrix,
              //   this.modelMatrix,
              //   new Matrix4()
              // ),
              Matrix4.fromScale(
                Matrix4.getScale(this.modelMatrix, new Cartesian3())
              ),
              new Plane(new Cartesian3(), 0)
            );
            return transformedPlane;
          }, false) as any,
          dimensions: new CallbackProperty(
            () => this.getPlaneDimensions(plane, new Cartesian2()),
            false
          ) as any,
          material: Color.WHITE.withAlpha(0.1) as any,
          outline: true as any,
          outlineColor: Color.WHITE as any,
          outlineWidth: 1 as any
        }
      });
      planeEntities.push(entity as any);
    });

    const cornerPoints = [
      new Cartesian3(-0.5, -0.5, -0.5),
      new Cartesian3(-0.5, 0.5, -0.5),
      new Cartesian3(0.5, -0.5, -0.5),
      new Cartesian3(0.5, 0.5, -0.5),
      new Cartesian3(-0.5, -0.5, 0.5),
      new Cartesian3(-0.5, 0.5, 0.5),
      new Cartesian3(0.5, -0.5, 0.5),
      new Cartesian3(0.5, 0.5, 0.5)
    ];

    const pointEntities: PointEntity[] = [];
    cornerPoints.forEach(point => {
      // this wont work when we invert the clipping plane cube
      const unorderedAdjacentPlanes = planeEntities
        .filter(entity => {
          const plane = entity.plane.plane.getValue(JulianDate.now());
          const dot = Cartesian3.dot(plane.normal, point);
          return dot < 0;
        })
        .map(entity => entity.plane);
      const adjacentPlanes = [
        unorderedAdjacentPlanes.find(
          plane => plane.plane.getValue(JulianDate.now()).normal.x !== 0
        ),
        unorderedAdjacentPlanes.find(
          plane => plane.plane.getValue(JulianDate.now()).normal.y !== 0
        ),
        unorderedAdjacentPlanes.find(
          plane => plane.plane.getValue(JulianDate.now()).normal.z !== 0
        )
      ];
      console.log(
        adjacentPlanes.map(
          plane => plane?.plane.getValue(JulianDate.now()).normal
        )
      );
      const entity = dataSource.entities.add({
        position: new CallbackProperty(() => {
          const position = Matrix4.multiplyByPoint(
            Matrix4.multiply(
              this.clippingPlanesOriginMatrix,
              this.modelMatrix,
              new Matrix4()
            ),
            point,
            new Cartesian3()
          );
          return position;
        }, false) as any,
        point: {
          pixelSize: 10,
          color: Color.WHITE
        },
        properties: {
          adjacentPlanes,
          highlight: () => {
            const point = entity.point;
            if (point) {
              point.color = Color.BLUE as any;
            }
            adjacentPlanes.forEach(plane => {
              plane!.material = Color.CYAN.withAlpha(0.1) as any;
            });
          },

          resetStyle: () => {
            const point = entity.point;
            if (point) {
              point.color = Color.WHITE as any;
            }
            adjacentPlanes.forEach(plane => {
              plane!.outlineColor = Color.WHITE as any;
            });
          }
        }
      });
      pointEntities.push(entity as any);
    });

    this.planeEventHandler?.destroy();
    this.planeEventHandler = new ScreenSpaceEventHandler(this.scene.canvas);
    this.setupPlaneEventHandler(this.planeEventHandler, planeEntities);

    this.pointEventHandler?.destroy();
    this.pointEventHandler = new ScreenSpaceEventHandler(this.scene.canvas);
    this.setupPointEventHandler(this.pointEventHandler, pointEntities);

    return dataSource;
  }

  @computed
  get clippingPlanes() {
    return [
      new ClippingPlane(new Cartesian3(0, 0, 1), 0.5),
      new ClippingPlane(new Cartesian3(0, 0, -1), 0.5),
      new ClippingPlane(new Cartesian3(0, 1, 0), 0.5),
      new ClippingPlane(new Cartesian3(0, -1, 0), 0.5),
      new ClippingPlane(new Cartesian3(1, 0, 0), 0.5),
      new ClippingPlane(new Cartesian3(-1, 0, 0), 0.5)

      // new ClippingPlane(new Cartesian3(0, 0, 1), -0.5),
      // new ClippingPlane(new Cartesian3(0, 0, -1), -0.5),
      // new ClippingPlane(new Cartesian3(0, 1, 0), -0.5),
      // new ClippingPlane(new Cartesian3(0, -1, 0), -0.5),
      // new ClippingPlane(new Cartesian3(1, 0, 0), -0.5),
      // new ClippingPlane(new Cartesian3(-1, 0, 0), -0.5)
    ];
  }

  @computed
  get clippingPlaneCollection(): ClippingPlaneCollection {
    const clippingPlaneCollection = new ClippingPlaneCollection({
      enabled: true,
      unionClippingRegions: true,
      planes: this.clippingPlanes
    });
    clippingPlaneCollection.modelMatrix = this.modelMatrix;
    return clippingPlaneCollection;
  }
}

function getPlaneCornerPoints(transform: Matrix4): Cartesian3[] {
  return [
    Matrix4.multiplyByPoint(
      transform,
      new Cartesian3(-0.5, -0.5, 1),
      new Cartesian3()
    ),
    Matrix4.multiplyByPoint(
      transform,
      new Cartesian3(-0.5, 0.5, 1),
      new Cartesian3()
    ),
    Matrix4.multiplyByPoint(
      transform,
      new Cartesian3(0.5, -0.5, 1),
      new Cartesian3()
    ),
    Matrix4.multiplyByPoint(
      transform,
      new Cartesian3(0.5, 0.5, 1),
      new Cartesian3()
    )
  ];
}

function getPlaneNormalAxis(plane: Plane): Axis | undefined {
  const match = (normal1: Cartesian3, normal2: Cartesian3) => {
    const dot = Math.abs(Cartesian3.dot(normal1, normal2));
    return CesiumMath.equalsEpsilon(dot, Math.abs(1), CesiumMath.EPSILON6);
  };
  const normal = plane.normal;
  return match(Cartesian3.UNIT_X, normal)
    ? Axis.X
    : match(Cartesian3.UNIT_Y, normal)
    ? Axis.Y
    : match(Cartesian3.UNIT_Z, normal)
    ? Axis.Z
    : undefined;
}

const cmCartesian2Scratch1 = new Cartesian2();
const cmCartesian2Scratch2 = new Cartesian2();

function computeMoveAmount(
  scene: Scene,
  clippingPlane: ClippingPlane,
  planePosition: Cartesian3,
  movement: MouseMovement,
  axisDimension: number
): number {
  const mouseMoveVector2d = Cartesian2.subtract(
    movement.startPosition,
    movement.endPosition,
    new Cartesian2()
  );

  const planeVector2d = screenProjectPlaneNormal(
    scene,
    clippingPlane,
    planePosition,
    axisDimension,
    new Cartesian2()
  );
  //const unit = Cartesian2.normalize(planeVector2d!, new Cartesian2());
  const unit = Cartesian2.normalize(
    screenProjectPlaneNormal(
      scene,
      clippingPlane,
      planePosition,
      axisDimension,
      new Cartesian2(),
      true
    )!,
    new Cartesian2()
  );
  const pixelAmount = unit ? Cartesian2.dot(mouseMoveVector2d, unit) : 0;
  const pixelLen = Cartesian2.magnitude(planeVector2d!);

  const cameraDir = Cartesian3.dot(
    scene.camera.direction,
    getPlaneRay(clippingPlane, planePosition, new Ray()).direction
  );

  console.log(
    axisDimension,
    pixelLen,
    pixelAmount,
    (pixelAmount * axisDimension) / pixelLen,
    clippingPlane.normal,
    mouseMoveVector2d,
    unit,
    planeVector2d,
    scene.camera.direction,
    Cartesian3.dot(
      scene.camera.direction,
      getPlaneRay(clippingPlane, planePosition, new Ray()).direction
    ),
    pixelAmount * Math.cos((Math.PI / 2) * cameraDir)
  );
  // console.log(
  //   axisDimension,
  //   moveAmount,
  //   len,
  //   (moveAmount * len) / axisDimension
  // );
  //return pixelAmount;

  return (
    (pixelAmount * Math.cos((Math.PI / 2) * cameraDir) * axisDimension) /
    pixelLen
  );
  //return pixelAmount;
  //return (pixelAmount * axisDimension) / (pixelLen * cameraDir);
}

const spCartesian3Scratch1 = new Cartesian3();
const spCartesian3Scratch2 = new Cartesian3();
const spCartesian2Scratch1 = new Cartesian2();
const spCartesian2Scratch2 = new Cartesian2();
const spRayScratch1 = new Ray();

// note: normalization removed
function screenProjectPlaneNormal(
  scene: Scene,
  plane: ClippingPlane,
  planePosition: Cartesian3,
  farPointDistance: number,
  result: Cartesian2,
  log = false
): Cartesian2 | undefined {
  const planeRay = getPlaneRay(plane, planePosition, spRayScratch1);
  // Screen projection point on the plane
  const nearPoint2d = scene.cartesianToCanvasCoordinates(
    Ray.getPoint(planeRay, 0, spCartesian3Scratch1),
    spCartesian2Scratch1
  );

  // Screen projection point on the plane normal at planePosition
  const farPoint2d = scene.cartesianToCanvasCoordinates(
    Ray.getPoint(planeRay, farPointDistance, spCartesian3Scratch2),
    spCartesian2Scratch2
  );

  if (log) {
    console.log("**pts**", farPoint2d, nearPoint2d);
  }

  if (nearPoint2d === undefined || farPoint2d === undefined) {
    return undefined;
  }

  // const planeVector2d = Cartesian2.normalize(
  //   Cartesian2.subtract(farPoint2d, nearPoint2d, result),
  //   result
  // );
  // return planeVector2d;
  return Cartesian2.subtract(farPoint2d, nearPoint2d, result);
}

const prMatrix4Scratch1 = new Matrix4();
const prCartesian3Scratch1 = new Cartesian3();
const prCartesian3Scratch2 = new Cartesian3();

export function getPlaneRay(
  plane: ClippingPlane,
  planePosition: Cartesian3,
  result: Ray
) {
  const ecefPlaneNormal = getEcefPlaneNormal(
    plane,
    planePosition,
    prCartesian3Scratch1
  );

  const pointOnPlane = planePosition;
  // const pointOnPlane = Cartesian3.add(
  //   planePosition,
  //   Cartesian3.multiplyByScalar(
  //     ecefPlaneNormal,
  //     -plane.distance,
  //     prCartesian3Scratch2
  //   ),
  //   prCartesian3Scratch2
  // );

  const planeRay = Ray.clone(new Ray(pointOnPlane, ecefPlaneNormal), result);
  return planeRay;
}

const ecefMatrix4Scratch1 = new Matrix4();

function getEcefPlaneNormal(
  plane: ClippingPlane,
  planePosition: Cartesian3,
  result: Cartesian3
) {
  const ecefTransform = Transforms.eastNorthUpToFixedFrame(
    planePosition,
    undefined,
    ecefMatrix4Scratch1
  );

  const ecefNormal = Cartesian3.normalize(
    Matrix4.multiplyByPointAsVector(ecefTransform, plane.normal, result),
    result
  );

  return ecefNormal;
}

export function screenToCartesian3(
  position: Cartesian2,
  scene: Scene
): Cartesian3 | undefined {
  const pickRay = scene.camera.getPickRay(position);
  const cartesian3 = scene.globe.pick(pickRay, scene);
  return cartesian3;
}

function setCanvasCursor(scene: Scene, cursorType: string) {
  scene.canvas.style.cursor = cursorType;
}

// import { computed } from "mobx";
// import Cartesian2 from "terriajs-cesium/Source/Core/Cartesian2";
// import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
// import Color from "terriajs-cesium/Source/Core/Color";
// import CesiumMath from "terriajs-cesium/Source/Core/Math";
// import Matrix4 from "terriajs-cesium/Source/Core/Matrix4";
// import Plane from "terriajs-cesium/Source/Core/Plane";
// import CallbackProperty from "terriajs-cesium/Source/DataSources/CallbackProperty";
// import CustomDataSource from "terriajs-cesium/Source/DataSources/CustomDataSource";
// import Axis from "terriajs-cesium/Source/Scene/Axis";
// import ClippingPlane from "terriajs-cesium/Source/Scene/ClippingPlane";
// import ClippingPlaneCollection from "terriajs-cesium/Source/Scene/ClippingPlaneCollection";
// import Scene from "terriajs-cesium/Source/Scene/Scene";

// export default class ClippingBox {
//   private modelMatrix: Matrix4;

//   constructor(
//     readonly scene: Scene,
//     readonly clippingPlanesOriginMatrix: Matrix4,
//     size: number
//   ) {
//     this.modelMatrix = Matrix4.fromScale(
//       new Cartesian3(size / 3, size / 2, size),
//       //new Cartesian3(32, 64, 128),
//       new Matrix4()
//     );
//   }

//   get boxPosition() {
//     const position = Matrix4.getTranslation(
//       Matrix4.multiply(
//         this.clippingPlanesOriginMatrix,
//         this.modelMatrix,
//         new Matrix4()
//       ),
//       new Cartesian3()
//     );
//     return position;
//   }

//   get boxDimensions(): Cartesian3 {
//     return Matrix4.getScale(this.modelMatrix, new Cartesian3());
//   }

//   getPlaneDimensions(plane: Plane, result: Cartesian2) {
//     const boxDimensions = this.boxDimensions;
//     const normalAxis = getPlaneNormalAxis(plane);
//     if (normalAxis === Axis.X) {
//       result.x = boxDimensions.y;
//       result.y = boxDimensions.z;
//     } else if (normalAxis === Axis.Y) {
//       result.x = boxDimensions.x;
//       result.y = boxDimensions.z;
//     } else if (normalAxis === Axis.Z) {
//       result.x = boxDimensions.x;
//       result.y = boxDimensions.y;
//     }
//     return result;
//   }

//   getPlaneDistance(plane: Plane) {
//     const boxDimensions = this.boxDimensions;
//     const normalAxis = getPlaneNormalAxis(plane);
//     if (normalAxis === Axis.X) {
//       return boxDimensions.x;
//     } else if (normalAxis === Axis.Y) {
//       return boxDimensions.y;
//     } else {
//       return boxDimensions.z;
//     }
//   }

//   @computed
//   get dataSource() {
//     const dataSource = new CustomDataSource();
//     this.clippingPlanes.forEach(plane => {
//       const entity = dataSource.entities.add({
//         position: new CallbackProperty(() => this.boxPosition, false) as any,
//         plane: {
//           plane: new CallbackProperty(() => {
//             const transformedPlane = Plane.clone(plane);
//             transformedPlane.distance = this.getPlaneDistance(plane) / 2;
//             return transformedPlane;
//             // const transformedPlane = Plane.transform(
//             //   plane,
//             //   this.modelMatrix,
//             //   new Plane(new Cartesian3(), 0)
//             // );
//             // return transformedPlane;
//           }, false) as any,
//           dimensions: new CallbackProperty(
//             () => this.getPlaneDimensions(plane, new Cartesian2()),
//             false
//           ) as any,
//           material: Color.WHITE.withAlpha(0.1) as any,
//           outline: true as any,
//           outlineColor: Color.WHITE as any,
//           outlineWidth: 1 as any
//         }
//       });
//     });

//     setInterval(() => {
//       const scale = Matrix4.getScale(this.modelMatrix, new Cartesian3());
//       const s = -Math.random() * 10;
//       scale.z += s;
//       Matrix4.setScale(this.modelMatrix, scale, this.modelMatrix);
//       Matrix4.multiply(
//         Matrix4.fromTranslation(new Cartesian3(0, 0, s / 2)),
//         this.modelMatrix,
//         this.modelMatrix
//       );
//     }, 1000);

//     return dataSource;
//   }

//   @computed
//   get clippingPlanes() {
//     return [
//       new ClippingPlane(new Cartesian3(0, 0, 1), 0.5),
//       new ClippingPlane(new Cartesian3(0, 0, -1), 0.5),
//       new ClippingPlane(new Cartesian3(0, 1, 0), 0.5),
//       new ClippingPlane(new Cartesian3(0, -1, 0), 0.5),
//       new ClippingPlane(new Cartesian3(1, 0, 0), 0.5),
//       new ClippingPlane(new Cartesian3(-1, 0, 0), 0.5)
//     ];
//   }

//   @computed
//   get clippingPlaneCollection(): ClippingPlaneCollection {
//     const clippingPlaneCollection = new ClippingPlaneCollection({
//       enabled: true,
//       unionClippingRegions: true,
//       planes: this.clippingPlanes
//     });
//     clippingPlaneCollection.modelMatrix = this.modelMatrix;
//     const matrix = Matrix4.inverseTranspose(
//       Matrix4.clone(this.modelMatrix, new Matrix4()),
//       new Matrix4()
//     );
//     console.log(
//       "**r**",
//       this.modelMatrix[3],
//       this.modelMatrix[7],
//       this.modelMatrix[11],
//       this.modelMatrix[15]
//     );
//     console.log("**w**", matrix[3], matrix[7], matrix[11], matrix[15]);

//     return clippingPlaneCollection;
//   }
// }

// function getPlaneNormalAxis(plane: Plane): Axis | undefined {
//   const match = (normal1: Cartesian3, normal2: Cartesian3) => {
//     const dot = Math.abs(Cartesian3.dot(normal1, normal2));
//     return CesiumMath.equalsEpsilon(dot, Math.abs(1), CesiumMath.EPSILON6);
//   };
//   const normal = plane.normal;
//   return match(Cartesian3.UNIT_X, normal)
//     ? Axis.X
//     : match(Cartesian3.UNIT_Y, normal)
//     ? Axis.Y
//     : match(Cartesian3.UNIT_Z, normal)
//     ? Axis.Z
//     : undefined;
// }
