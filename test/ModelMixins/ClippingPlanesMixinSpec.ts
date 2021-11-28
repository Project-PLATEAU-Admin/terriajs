import BoundingSphere from "terriajs-cesium/Source/Core/BoundingSphere";
import Cartesian3 from "terriajs-cesium/Source/Core/Cartesian3";
import ClippingPlanesMixin from "../../lib/ModelMixins/ClippingPlanesMixin";
import CreateModel from "../../lib/Models/Definition/CreateModel";
import Terria from "../../lib/Models/Terria";
import mixTraits from "../../lib/Traits/mixTraits";
import ClippingPlanesTraits from "../../lib/Traits/TraitsClasses/ClippingPlanesTraits";
import MappableTraits from "../../lib/Traits/TraitsClasses/MappableTraits";

class Test extends ClippingPlanesMixin(
  CreateModel(mixTraits(ClippingPlanesTraits, MappableTraits))
) {
  modelBoundingSphere() {
    return new BoundingSphere(Cartesian3.fromDegrees(140, 40, 0), 5);
  }
}

describe("ClippingPlanesMixinSpec", function() {
  let terria: Terria;

  beforeEach(function() {
    terria = new Terria();
  });

  describe("selectableDimension", function() {
    it("is a group with 3 child dimensions", function() {
      const item = new Test("terria", terria);
      const dim = item.clippingPlanesDimension;
      expect(dim).toBeDefined();
      expect(dim.type).toBe("group");
      if (dim.type === "group") {
        expect(dim.selectableDimensions.length).toBe(2);
      }
    });
  });

  describe("clipping planes interaction", function() {
    it("is stopped when showEditorUi is set to false");
    it("is stopped when the clipping planes collection is disabled");
    it(
      "is stopped when show is set to false for the clipping plane data source"
    );
  });

  describe("clippingPlanesDatasource", function() {
    it("is undefined when showEditorUi is false");
    it("is undefined when clippingPlanes is disabled");
    it("has a plane entity for each clipping plane");
    it("stops interaction when show is set to false");
    it("starts interaction when show is set to true");
  });
});
