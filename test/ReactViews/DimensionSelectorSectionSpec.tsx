import { runInAction } from "mobx";
import React from "react";
import ReactSelect from "react-select";
import TestRenderer from "react-test-renderer";
import { ThemeProvider } from "styled-components";
import CatalogMemberMixin from "../../lib/ModelMixins/CatalogMemberMixin";
import CsvCatalogItem from "../../lib/Models/Catalog/CatalogItems/CsvCatalogItem";
import WebMapServiceCatalogItem from "../../lib/Models/Catalog/Ows/WebMapServiceCatalogItem";
import CommonStrata from "../../lib/Models/Definition/CommonStrata";
import CreateModel from "../../lib/Models/Definition/CreateModel";
import SelectableDimensions, {
  DEFAULT_PLACEMENT,
  SelectableDimension
} from "../../lib/Models/SelectableDimensions/SelectableDimensions";
import Terria from "../../lib/Models/Terria";
import { terriaTheme } from "../../lib/ReactViews/StandardUserInterface/StandardTheme";
import DimensionSelectorSection, {
  DimensionSelectorGroup
} from "../../lib/ReactViews/Workbench/Controls/SelectableDimensionSection";
import Checkbox from "../../lib/Styled/Checkbox";
import Select from "../../lib/Styled/Select";
import CatalogMemberTraits from "../../lib/Traits/TraitsClasses/CatalogMemberTraits";

export default class TestCatalogItem
  extends CatalogMemberMixin(CreateModel(CatalogMemberTraits))
  implements SelectableDimensions {
  static readonly type = "stub";
  get type() {
    return "test";
  }

  selectableDimensions: SelectableDimension[] = [
    {
      id: "some-id",
      name: "Some name",
      options: [
        { id: "option-1", name: "Option 1" },
        { id: "option-2", name: "Option 2" }
      ],
      selectedId: "option-2",
      allowUndefined: true,
      setDimensionValue: (stratumId: string, newStyle: string) => {}
    },
    {
      id: "some-id-2",
      name: "Some name 2",
      options: [
        { id: "option-3", name: "Option 3" },
        { id: "option-4", name: "Option 4" },
        { id: "option-5", name: "Option 5" }
      ],
      selectedId: "option-3",
      allowUndefined: false,
      setDimensionValue: (stratumId: string, newStyle: string) => {}
    },
    {
      id: "some-id-3",
      name: "Some name 3",
      options: [
        { id: "option-6", name: "Neko" },
        { id: "option-7", name: "Mochi" },
        { id: "option-8", name: "A dog" }
      ],
      selectedId: "option-8",
      allowUndefined: false,
      setDimensionValue: (stratumId: string, newStyle: string) => {},
      disable: true
    },
    {
      id: "some-id-4",
      name: "Some name 4",
      options: [
        { id: "true", name: "Option 1" },
        { id: "false", name: "Option 2" }
      ],
      selectedId: "false",
      type: "checkbox",
      setDimensionValue: (stratumId, newStyle) => {}
    }
  ];
}

describe("DimensionSelectorSection", function() {
  let terria: Terria;

  beforeEach(function() {
    terria = new Terria({
      baseUrl: "./"
    });
  });

  it("shows all dimensions and styles for a mock layer", function(done) {
    const mockItem = new TestCatalogItem("what", terria);

    const section = TestRenderer.create(
      <ThemeProvider theme={terriaTheme}>
        <DimensionSelectorSection
          item={mockItem}
          placement={DEFAULT_PLACEMENT}
        />
      </ThemeProvider>
    );

    const selects = section.root.findAllByType(ReactSelect);
    expect(selects.length).toBe(2); // The 3rd Dimension has disable:true

    const checkboxes = section.root.findAllByType(Checkbox);
    expect(checkboxes.length).toBe(1);

    done();
  });

  it("show dimensions and styles for a 'real' WMS layer", function(done) {
    const wmsItem = new WebMapServiceCatalogItem("some-layer", terria);
    runInAction(() => {
      wmsItem.setTrait(CommonStrata.definition, "url", "http://example.com");
      wmsItem.setTrait(
        CommonStrata.definition,
        "getCapabilitiesUrl",
        "test/WMS/styles_and_dimensions.xml"
      );
      wmsItem.setTrait(CommonStrata.definition, "layers", "A,B");
      wmsItem.setTrait(CommonStrata.definition, "dimensions", {
        styles: "contour/ferret,shadefill/alg2",
        custom: "Another thing",
        elevation: "-0.59375"
      });
      wmsItem.setTrait(
        CommonStrata.definition,
        "styles",
        "contour/ferret,shadefill/alg2"
      );
    });

    wmsItem
      .loadMetadata()
      .then(function() {
        const section = TestRenderer.create(
          <ThemeProvider theme={terriaTheme}>
            <DimensionSelectorSection
              item={wmsItem}
              placement={DEFAULT_PLACEMENT}
            />
          </ThemeProvider>
        );

        const selects = section.root.findAllByType(ReactSelect);
        const labels = section.root.findAllByType("label");

        // Expect 3 dimensions (elevation, custom, another) + 2 styles (layer A, layer B)
        expect(selects.length).toBe(5);
        expect(labels.length).toBe(5);
      })
      .then(done)
      .catch(done.fail);
  });

  it("shows csv region mapping options", async function(done) {
    jasmine.Ajax.install();
    jasmine.Ajax.stubRequest(
      "build/TerriaJS/data/regionMapping.json"
    ).andReturn({
      responseText: JSON.stringify(
        require("../../wwwroot/data/regionMapping.json")
      )
    });

    jasmine.Ajax.stubRequest(
      "build/TerriaJS/data/regionids/region_map-FID_LGA_2015_AUST_LGA_CODE15.json"
    ).andReturn({
      responseText: JSON.stringify(
        require("../../wwwroot/data/regionids/region_map-FID_LGA_2015_AUST_LGA_CODE15.json")
      )
    });

    jasmine.Ajax.stubRequest("test/csv/lga_code_2015.csv").andReturn({
      responseText: require("raw-loader!../../wwwroot/test/csv/lga_code_2015.csv")
    });

    const csvItem = new CsvCatalogItem("some-csv", terria, undefined);

    runInAction(() => {
      csvItem.setTrait(
        CommonStrata.definition,
        "url",
        "test/csv/lga_code_2015.csv"
      );

      csvItem.setTrait(
        CommonStrata.definition,
        "enableManualRegionMapping",
        true
      );
    });

    await csvItem.loadMapItems();

    const section = TestRenderer.create(
      <ThemeProvider theme={terriaTheme}>
        <DimensionSelectorSection
          item={csvItem}
          placement={DEFAULT_PLACEMENT}
        />
      </ThemeProvider>
    );

    // Note: there will only be 2 selects: one for region column and one for region mapping.
    // The activeStyle select is hidden as there is only one option
    const selects = section.root.findAllByType(ReactSelect);
    expect(selects.length).toBe(2);

    if (selects.length < 2) {
      done.fail("Not enough select objects");
    }

    done();

    jasmine.Ajax.uninstall();
  });

  describe("when given a SelectableDimensionCheckboxGroup", function() {
    let mockItem: TestCatalogItem;

    beforeEach(function() {
      mockItem = new TestCatalogItem("what", terria);
      mockItem.selectableDimensions = [
        {
          id: "checkbox-group1",
          type: "checkbox-group",
          selectedId: "true",
          options: [
            {
              id: "true",
              name: "true"
            },
            {
              id: "false",
              name: "false"
            }
          ],
          setDimensionValue: () => {},
          selectableDimensions: [
            {
              id: "checkbox-1",
              type: "checkbox",
              name: "Checkbox 1",
              selectedId: "true",
              options: [
                { id: "true", name: "When checked" },
                { id: "false", name: "When unchecked" }
              ],
              setDimensionValue: () => {}
            },
            {
              id: "select-1",
              type: "select",
              name: "Dropdown 1",
              selectedId: "true",
              options: [
                { id: "option-1", name: "Option 1" },
                { id: "option-2", name: "Option 2" }
              ],
              setDimensionValue: () => {}
            },
            {
              disable: true,
              id: "select-2",
              type: "select",
              name: "Dropdown 2",
              selectedId: "true",
              options: [
                { id: "option-3", name: "Option 3" },
                { id: "option-4", name: "Option 4" }
              ],
              setDimensionValue: () => {}
            }
          ]
        }
      ];
    });

    // it("renders the checkbox group correctly", function() {
    //   const section = TestRenderer.create(
    //     <ThemeProvider theme={terriaTheme}>
    //       <DimensionSelectorSection
    //         item={mockItem}
    //         placement={DEFAULT_PLACEMENT}
    //       />
    //     </ThemeProvider>
    //   );

    //   const checkboxGroup = section.root.findByType(
    //     DimensionSelectorCheckboxGroup
    //   );
    //   expect(checkboxGroup.props.dimension.type).toEqual("checkbox-group");
    // });

    // it("renders all the group children excluding the disabled ones", function() {
    //   const section = TestRenderer.create(
    //     <ThemeProvider theme={terriaTheme}>
    //       <DimensionSelectorSection
    //         item={mockItem}
    //         placement={DEFAULT_PLACEMENT}
    //       />
    //     </ThemeProvider>
    //   );
    //   const selects = section.root.findAllByType(Select);
    //   const checkboxes = section.root.findAllByType(Checkbox);
    //   expect(selects.length).toEqual(1);
    //   // first checkbox is the group checkbox
    //   expect(checkboxes.slice(1).length).toEqual(1);
    // });
  });

  describe("when given a SelectableDimensionGroup", function() {
    let mockItem: TestCatalogItem;

    beforeEach(function() {
      mockItem = new TestCatalogItem("what", terria);
      mockItem.selectableDimensions = [
        {
          id: "group",
          type: "group",
          name: "Selectable group",
          isOpen: true,
          selectableDimensions: [
            {
              id: "checkbox-1",
              type: "checkbox",
              name: "Checkbox 1",
              selectedId: "true",
              options: [
                { id: "true", name: "When checked" },
                { id: "false", name: "When unchecked" }
              ],
              setDimensionValue: () => {}
            },
            {
              id: "select-1",
              type: "select",
              name: "Dropdown 1",
              selectedId: "true",
              options: [
                { id: "option-1", name: "Option 1" },
                { id: "option-2", name: "Option 2" }
              ],
              setDimensionValue: () => {}
            },
            {
              disable: true,
              id: "select-2",
              type: "select",
              name: "Dropdown 2",
              selectedId: "true",
              options: [
                { id: "option-3", name: "Option 3" },
                { id: "option-4", name: "Option 4" }
              ],
              setDimensionValue: () => {}
            }
          ]
        }
      ];
    });

    it("renders the group", function() {
      const section = TestRenderer.create(
        <ThemeProvider theme={terriaTheme}>
          <DimensionSelectorSection
            item={mockItem}
            placement={DEFAULT_PLACEMENT}
          />
        </ThemeProvider>
      );

      const group = section.root.findByType(DimensionSelectorGroup);
      expect(group.props.dim.type).toEqual("group");
    });

    it("renders all the group children excluding the disabled ones", function() {
      const section = TestRenderer.create(
        <ThemeProvider theme={terriaTheme}>
          <DimensionSelectorSection
            item={mockItem}
            placement={DEFAULT_PLACEMENT}
          />
        </ThemeProvider>
      );

      const selects = section.root.findAllByType(Select);
      const checkboxes = section.root.findAllByType(Checkbox);
      expect(selects.length).toEqual(1);
      expect(checkboxes.length).toEqual(1);
    });
  });
});
