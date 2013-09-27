/*global define: false, d3: false */
/*jshint multistr: true */

define(function(require) {
  // Dependencies.
  var PIXI     = require('pixi'),
      canvg    = require('canvg'),
      mustache = require('mustache'),
      alert    = require('common/alert'),

      atomSVG =
      '<svg x="0px" y="0px" width="{{ width }}px" height="{{ height }}px" \
       viewBox="0 0 32 32" xml:space="preserve"> \
        <style type="text/css"> \
        <![CDATA[ \
          text { \
            font-family: Lato, OpenSans, helvetica, sans-serif; \
            font-size: {{ fontSize }}px; \
            font-weight: bold; \
            fill: #222; \
          } \
          .shadow { \
            stroke: rgba(255, 255, 255, 0.7); \
            stroke-width: 2px; \
          } \
        ]]> \
        </style> \
         <defs> \
           <radialGradient id="grad" cx="50%" cy="47%" r="53%" fx="35%" fy="30%"> \
           <stop stop-color="{{ lightCol }}" offset="0%"></stop> \
           <stop stop-color="{{ medCol }}" offset="40%"></stop> \
           <stop stop-color="{{ darkCol }}" offset="80%"></stop> \
           <stop stop-color="{{ medCol }}" offset="100%"></stop> \
           </radialGradient> \
         </defs> \
         <circle fill="url(#grad)" cx="16" cy="16" r="16" fill-opacity="{{ opacity }}"/> \
         <text class="shadow" text-anchor="middle" x="16" y="16" dy="0.31em">{{ label }}</text> \
         <text text-anchor="middle" x="16" y="16" dy="0.31em">{{ label }}</text> \
       </svg>',

      KE_SHADING_MIN_COLORS = ["#FFFFFF", "#F2F2F2", "#A4A4A4"],
      KE_SHADING_MAX_COLORS = ["#FFFFFF", "#FF8080", "#FF2020"],

      // Scales used for Charge Shading gradients.
      CHARGE_SHADING_STEPS = 25,
      NEUTRAL_COLORS = ["#FFFFFF", "#f2f2f2", "#A4A4A4"],
      posLightColor = d3.scale.linear()
        .interpolate(d3.interpolateRgb)
        .range(["#FFFFFF", "#ffefff"]),
      posMedColor = d3.scale.linear()
        .interpolate(d3.interpolateRgb)
        .range(["#f2f2f2", "#9090FF"]),
      posDarkColor = d3.scale.linear()
        .interpolate(d3.interpolateRgb)
        .range(["#A4A4A4", "#3030FF"]),
      negLightColor = d3.scale.linear()
        .interpolate(d3.interpolateRgb)
        .range(["#FFFFFF", "#dfffff"]),
      negMedColor = d3.scale.linear()
        .interpolate(d3.interpolateRgb)
        .range(["#f2f2f2", "#FF8080"]),
      negDarkColor = d3.scale.linear()
        .interpolate(d3.interpolateRgb)
        .range(["#A4A4A4", "#FF2020"]),

      getChargeShadingColors = function (charge) {
        var chargeIndex = Math.round(Math.min(Math.abs(charge) / 3, 1) * CHARGE_SHADING_STEPS);
        chargeIndex /= CHARGE_SHADING_STEPS;
        if (charge > 0) {
          return [posLightColor(chargeIndex), posMedColor(chargeIndex), posDarkColor(chargeIndex)];
        } else if (charge < 0) {
          return [negLightColor(chargeIndex), negMedColor(chargeIndex), negDarkColor(chargeIndex)];
        }
        return NEUTRAL_COLORS;
      },

      getHydrophobicityColors = function (h) {
        return h > 0 ?  ["#F0E6D1", "#E0A21B", "#AD7F1C"] : ["#dfffef", "#75a643", "#2a7216"];
      },

      RENDERING_OPTIONS = ["keShading", "chargeShading", "atomNumbers", "showChargeSymbols",
                           "aminoAcidColorScheme", "useThreeLetterCode", "viewPortZoom"];

  return function AtomsRenderer(modelView, model, pixiContainer) {
    // Public API object to be returned.
    var api,

        container,

        m2px,
        m2pxInv,

        modelAtoms,
        viewAtoms,

        elementTex = {},

        modelWidth,
        modelHeight,

        // Rendering options:
        renderMode = {};

    function init() {
      modelWidth = model.get("width");
      modelHeight = model.get("height");
      readRenderingOptions();
      // Modes require .setup() call:
      model.addPropertiesListener(RENDERING_OPTIONS, function () {
        readRenderingOptions();
        api.setup();
        modelView.renderCanvas();
      });
    }

    function readRenderingOptions() {
      RENDERING_OPTIONS.forEach(function (name) {
        renderMode[name] = model.get(name);
      });
    }

    function getAtomColors(i) {
      var atom = modelAtoms[i],
          elID = atom.element,
          props = model.getElementProperties(elID),
          colorStr, color;

      if (atom.marked) {
        colorStr = model.get("markColor");
        color = d3.rgb(colorStr);
        return [color.brighter(1).toString(), color.toString(), color.darker(1).toString()];
      }

      if (atom.aminoAcid) {
        switch(renderMode.aminoAcidColorScheme) {
          case "charge":
            return getChargeShadingColors(atom.charge);
          case "hydrophobicity":
            return getHydrophobicityColors(atom.hydrophobicity);
          case "chargeAndHydro":
            if (atom.charge !== 0) {
              return getChargeShadingColors(atom.charge);
            }
            return getHydrophobicityColors(atom.hydrophobicity);
          // case "none":
          // Do nothing, default rendering will be used.
        }
      }

      if (renderMode.keShading) {
        return KE_SHADING_MIN_COLORS;
      } else if (renderMode.chargeShading) {
        return getChargeShadingColors(atom.charge);
      } else {
        // Weird conversion, as we use color values literally imported from Classic MW. Perhaps we
        // should do that in MML -> JSON converter.
        colorStr = (props.color + Math.pow(2, 24)).toString(16);
        colorStr = "000000".substr(0, 6 - colorStr.length) + colorStr;
        color = d3.rgb("#" + colorStr);
        return [color.brighter(1).toString(), color.toString(), color.darker(1).toString()];
      }
    }

    function getAtomTexture(i, colors) {
      var elID = modelAtoms[i].element,
          radius = m2px(model.getElementProperties(elID).radius),
          visible = modelAtoms[i].visible,
          label = getAtomLabel(i),
          key;

      colors = colors || getAtomColors(i);
      key = visible ? (elID + "-" + radius + "-" + colors.join("") + "-" + label.text + "-" + label.fontSize) :
                      (radius + "-invisible");

      if (elementTex[key] === undefined) {
        var canv = document.createElement("canvas"),
            tplData;

        tplData = {
          width: 2 * radius,
          height: 2 * radius,
          lightCol: colors[0],
          medCol: colors[1],
          darkCol: colors[2],
          opacity: visible,
          label: label.text,
          fontSize: label.fontSize
        };

        canvg(canv, mustache.render(atomSVG, tplData));
        elementTex[key] = new PIXI.Texture.fromCanvas(canv);
      }
      return elementTex[key];
    }

    function getAtomLabel(i) {
      var textVal = "",
          sizeRatio = 0;

      if (renderMode.atomNumbers) {
        textVal = i;
        sizeRatio = 1.2;
      } else if (renderMode.useThreeLetterCode && modelAtoms[i].label) {
        textVal = modelAtoms[i].label;
        sizeRatio = 1;
      } else if (!renderMode.useThreeLetterCode && modelAtoms[i].symbol) {
        textVal = modelAtoms[i].symbol;
        sizeRatio = 1.4;
      } else if (renderMode.showChargeSymbols) {
        if (modelAtoms[i].charge > 0) {
          textVal = "+";
        } else if (modelAtoms[i].charge < 0) {
          textVal = "-";
        }
        sizeRatio = 1.6;
      }

      return {
        text: textVal,
        fontSize: sizeRatio * 16 // In fact: sizeRatio * atom radius. The value 16 is based on the
                                 // current SVG viewBox and <circle> "r" property.
      };
    }

    function dragBehavior(viewAtom, data) {
      var i = viewAtom.i,
          x, y, originX, originY,
          parentOffset, parentOversampling,
          dragged = false;

      $(window).on("mousemove.drag", function (e) {
        if (!dragged) {
          // Lazily initialize drag process when user really drags an atom (not only clicks it).
          if (model.isStopped()) {
            originX = modelAtoms[i].x;
            originY = modelAtoms[i].y;
          } else if (modelAtoms[i].draggable) {
            model.liveDragStart(i);
          }

          var $target = $(data.originalEvent.target);
          parentOffset = $target.offset();
          parentOversampling = $target.attr("width") / $target.width();

          dragged = true;
        }

        x = m2px.invert((e.clientX - parentOffset.left) * parentOversampling);
        y = m2pxInv.invert((e.clientY - parentOffset.top) * parentOversampling);

        var bbox = model.getMoleculeBoundingBox(i);
        if (bbox.left + x < 0) x = 0 - bbox.left;
        if (bbox.right + x > modelWidth) x = modelWidth - bbox.right;
        if (bbox.bottom + y < 0) y = 0 - bbox.bottom;
        if (bbox.top + y > modelHeight) y = modelHeight - bbox.top;

        if (model.isStopped()) {
          setAtomPosition(i, x, y, false, true);
          modelView.update();
        } else {
          model.liveDrag(x, y);
        }
      }).one("mouseup.drag", function () {
        $(window).off("mousemove.drag");

        // If user only clicked an atom (mousedown + mouseup, no mousemove), there is nothing to do.
        if (!dragged) return;

        if (model.isStopped()) {
          if (!setAtomPosition(i, x, y, true, true)) {
            alert("You can't drop the atom there");
            setAtomPosition(i, originX, originY, false, true);
            modelView.update();
          }
        } else {
          model.liveDragEnd();
        }
      });
    }

    function mouseDown(data) {
      modelView.hitTestFlag = true;

      dragBehavior(this, data);
    }

    function setAtomPosition(i, xpos, ypos, checkPosition, moveMolecule) {
      return model.setAtomProperties(i, {
        x: xpos,
        y: ypos
      }, checkPosition, moveMolecule);
    }

    api = {
      setup: function () {
        var i, len, atom, keSprite;

        if (container) {
          pixiContainer.removeChild(container);
        }
        container = new PIXI.DisplayObjectContainer();
        pixiContainer.addChild(container);

        m2px = modelView.model2canvas;
        m2pxInv = modelView.model2canvasInv;

        viewAtoms = [];
        modelAtoms = model.getAtoms();

        for (i = 0, len = modelAtoms.length; i < len; ++i) {
          atom = new PIXI.Sprite(getAtomTexture(i));
          atom.anchor.x = 0.5;
          atom.anchor.y = 0.5;

          atom.i = i;

          atom.setInteractive(true);
          atom.mousedown = atom.touchstart = mouseDown;

          if (renderMode.keShading) {
            keSprite = new PIXI.Sprite(getAtomTexture(i, KE_SHADING_MAX_COLORS));
            keSprite.anchor.x = 0.5;
            keSprite.anchor.y = 0.5;
            atom.keSprite = keSprite;
            atom.addChild(keSprite);
          }

          viewAtoms.push(atom);
          container.addChild(atom);
        }

        api.update();
      },

      bindModel: function (newModel) {
        model = newModel;
        init();
      },

      update: function () {
        var i, len, viewAtom, x, y;

        for (i = 0, len = viewAtoms.length; i < len; ++i) {
          viewAtom = viewAtoms[i];
          x = m2px(modelAtoms[i].x);
          y = m2pxInv(modelAtoms[i].y);

          viewAtom.position.x = x;
          viewAtom.position.y = y;

          if (renderMode.keShading) {
            viewAtom.keSprite.alpha = Math.min(5 * model.getAtomKineticEnergy(i), 1);
          }
        }
      },

      getAtomColors: getAtomColors
    };

    init();

    return api;
  };
});
