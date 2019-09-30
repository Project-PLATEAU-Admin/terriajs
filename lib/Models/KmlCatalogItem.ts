import { computed } from "mobx";

import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import Cartographic from "terriajs-cesium/Source/Core/Cartographic";
import Ellipsoid from "terriajs-cesium/Source/Core/Ellipsoid";
import isDefined from "../Core/isDefined";
import JulianDate from "terriajs-cesium/Source/Core/JulianDate";
import KmlDataSource from "terriajs-cesium/Source/DataSources/KmlDataSource";
import PolygonHierarchy from "terriajs-cesium/Source/Core/PolygonHierarchy";
import readXml from "../Core/readXml";
import sampleTerrain from "terriajs-cesium/Source/Core/sampleTerrain";
import TerriaError from "../Core/TerriaError";
import AsyncMappableMixin from "../ModelMixins/AsyncMappableMixin";
import CatalogMemberMixin from "../ModelMixins/CatalogMemberMixin";
import CreateModel from "./CreateModel";
import KmlCatalogItemTraits from "../Traits/KmlCatalogItemTraits"
import UrlMixin from "../ModelMixins/UrlMixin";
import Terria from "./Terria";
import Property from "terriajs-cesium/Source/Core/Property";

const kmzRegex = /\.kmz$/i;

class KmlCatalogItem extends AsyncMappableMixin(
  UrlMixin(CatalogMemberMixin(CreateModel(KmlCatalogItemTraits)))
) {
  static readonly type = "kml";
  get type() {
    return KmlCatalogItem.type;
  }
  
  private _dataSource: KmlDataSource | undefined;

  private _kmlFile?: File;

  readonly canZoomTo = true;

  constructor(id: string, terria: Terria) {
      super(id, terria);
  }

  setFileInput(file: File) {
    this._kmlFile = file;
  }

  protected forceLoadMapItems(): Promise<void> {
      const createLoadError = () =>
        new TerriaError({
          sender: this,
          title: "Error loading KML or KMZ",
          message:
            `An error occurred while loading a KML or KMZ file. This may indicate that the file is invalid or ` +
            `that it is not supported by ${this.terria.appName}. If you would like assistance or further ` +
            `information, please email us at ` +
            `<a href="mailto:${this.terria.supportEmail}">${this.terria.supportEmail}></a>.`
        });

      return new Promise<string | Document | Blob>((resolve, reject) => {
        if (isDefined(this.kmlString)) {
          const parser = new DOMParser();
          resolve(parser.parseFromString(this.kmlString, "text/xml"));
        } else if (isDefined(this._kmlFile)) {
          if (this.url && this.url.match(kmzRegex)) {
            resolve(this.url);
          } else {
            resolve(readXml(this._kmlFile));
          }
        } else if (isDefined(this.url)) {
          resolve(this.url);
        } else {
          throw new TerriaError({
            sender: this,
            title: "No KML available",
            message:
              `The KML/KMZ catalog item cannot be loaded because it was not configured ` +
              `with a \`url\`, \`kmlData\` or \`kmlString\` property.`
          });
        }
      })
        .then(kmlLoadInput => {
          return KmlDataSource.load(kmlLoadInput);
        })
        .then(dataSource => {
          this._dataSource = dataSource;
          this.doneLoading(dataSource); // Unsure if this is necessary
        })
        .catch(e => {
          if (e instanceof TerriaError) {
            throw e;
          } else {
            throw createLoadError();
          }
        })
  }

  @computed
  get mapItems() {
    if (this.isLoadingMapItems || this._dataSource === undefined) {
      return [];
    }
    this._dataSource.show = this.show;
    return [this._dataSource];
  }

  protected forceLoadMetadata(): Promise<void> {
      return Promise.resolve();
  }

  private doneLoading(kmlDataSource: KmlDataSource) {
    // Clamp features to terrain.
    if (isDefined(this.terria.cesium)) {
      const positionsToSample : Cartographic[] = [];
      const correspondingCartesians : Cartesian3[] = [];

      const entities = kmlDataSource.entities.values;
      for (let i = 0; i < entities.length; ++i) {
        const entity = entities[i];

        const polygon = entity.polygon;
        if (isDefined(polygon)) {
          polygon.perPositionHeight = (true as unknown) as Property;
          const polygonHierarchy = getPropertyValue<PolygonHierarchy>(polygon.hierarchy);
          samplePolygonHierarchyPositions(
            polygonHierarchy,
            positionsToSample,
            correspondingCartesians
          );
        }
      }
      const terrainProvider = this.terria.cesium.scene.globe.terrainProvider;
      sampleTerrain(terrainProvider, 11, positionsToSample).then(function() {
        for (let i = 0; i < positionsToSample.length; ++i) {
          const position = positionsToSample[i];
          if (!isDefined(position.height)) {
            continue;
          }

          Ellipsoid.WGS84.cartographicToCartesian(
            position,
            correspondingCartesians[i]
          );
        }

        // Force the polygons to be rebuilt.
        for (let i = 0; i < entities.length; ++i) {
          const polygon = entities[i].polygon;
          if (!isDefined(polygon)) {
            continue;
          }

          const existingHierarchy = getPropertyValue<PolygonHierarchy>(polygon.hierarchy);
          polygon.hierarchy = new PolygonHierarchy(
            existingHierarchy.positions,
            existingHierarchy.holes
          );
        }
      });
    }
  }
}

export default KmlCatalogItem;

function getPropertyValue<T>(property: Property): T {
  return property.getValue(JulianDate.now());
}

function samplePolygonHierarchyPositions(
  polygonHierarchy: PolygonHierarchy,
  positionsToSample: Cartographic[],
  correspondingCartesians: Cartesian3[]
) {
  const positions = polygonHierarchy.positions;

  for (let i = 0; i < positions.length; ++i) {
    const position = positions[i];
    correspondingCartesians.push(position);
    positionsToSample.push(Ellipsoid.WGS84.cartesianToCartographic(position));
  }

  const holes = polygonHierarchy.holes;
  for (let i = 0; i < holes.length; ++i) {
    samplePolygonHierarchyPositions(
      holes[i],
      positionsToSample,
      correspondingCartesians
    );
  }
}

