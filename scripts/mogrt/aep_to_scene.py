#!/usr/bin/env python3
"""Emit Scene JSON (docs/mogrt-scene-schema.md section 1) from an .aep using py_aep.

Usage: python aep_to_scene.py <file.aep> [out.json]

This is the ORACLE for the JavaScript reader in src/Services/mogrt/aep/.
"""
from __future__ import annotations

import json
import math
import sys
import traceback

from py_aep import parse
from py_aep.enums.property import PropertyValueType as PVT, PropertyControlType as PCT
from py_aep.enums.general import PropertyType

try:
    from py_aep.models.layers.layer import Layer
    from py_aep.models.properties.property import Property
    from py_aep.models.properties.property_group import PropertyGroup
    from py_aep.models.items.composition import CompItem
    from py_aep.models.items.footage import FootageItem
    from py_aep.models.properties.shape import Shape
    from py_aep.models.properties.gradient import Gradient
    from py_aep.models.properties.marker import MarkerValue
    from py_aep.models.text.text_document import TextDocument
except Exception:  # pragma: no cover
    raise

ERRORS = []


def err(where, e):
    ERRORS.append(f"{where}: {type(e).__name__}: {e}")


def num(x):
    if isinstance(x, bool):
        return x
    if isinstance(x, int):
        return x
    try:
        f = float(x)
    except Exception:
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return f


def jv(x):
    """Generic JSON-safe conversion of numbers / lists / tuples."""
    if x is None or isinstance(x, (bool, str)):
        return x
    if isinstance(x, (int, float)):
        return num(x)
    if isinstance(x, (list, tuple)):
        return [jv(i) for i in x]
    if isinstance(x, dict):
        return {str(k): jv(v) for k, v in x.items()}
    n = num(x)
    return n


def safe(fn, default=None, where=""):
    try:
        return fn()
    except Exception as e:  # noqa: BLE001
        if where:
            err(where, e)
        return default


VALUE_TYPE = {
    PVT.OneD: "ONE_D",
    PVT.TwoD: "TWO_D",
    PVT.TwoD_SPATIAL: "TWO_D",
    PVT.ThreeD: "THREE_D",
    PVT.ThreeD_SPATIAL: "THREE_D",
    PVT.COLOR: "COLOR",
    PVT.SHAPE: "SHAPE",
    PVT.TEXT_DOCUMENT: "TEXT_DOCUMENT",
    PVT.MARKER: "MARKER",
    PVT.LAYER_INDEX: "LAYER_INDEX",
    PVT.MASK_INDEX: "MASK_INDEX",
    PVT.NO_VALUE: "NO_VALUE",
    PVT.CUSTOM_VALUE: "CUSTOM",
    PVT.ORIENTATION: "THREE_D",
}
DIMS = {"ONE_D": 1, "TWO_D": 2, "THREE_D": 3, "COLOR": 4}

CONTROL_TYPE = {
    PCT.LAYER: "LAYER",
    PCT.INTEGER: "SLIDER",
    PCT.SCALAR: "SLIDER",
    PCT.SLIDER: "SLIDER",
    PCT.ANGLE: "ANGLE",
    PCT.BOOLEAN: "CHECKBOX",
    PCT.COLOR: "COLOR",
    PCT.TWO_D: "POINT",
    PCT.THREE_D: "POINT3D",
    PCT.ENUM: "DROPDOWN",
    PCT.PAINT_GROUP: "NO_CONTROL",
    PCT.CURVE: "CURVE",
    PCT.MASK: "MASK",
    PCT.GROUP: "GROUP",
}


def shape_json(s):
    return {
        "closed": bool(s.closed),
        "vertices": jv(s.vertices),
        "inTangents": jv(s.in_tangents),
        "outTangents": jv(s.out_tangents),
    }


def gradient_json(g):
    return {
        "type": None,
        "colorStops": [
            {"position": num(c.offset), "midpoint": num(c.midpoint), "color": jv(c.color)}
            for c in g.color_stops
        ],
        "alphaStops": [
            {"position": num(a.offset), "midpoint": num(a.midpoint), "alpha": num(a.alpha)}
            for a in g.alpha_stops
        ],
    }


def marker_json(m, time=None):
    return {
        "time": time,
        "protectedRegion": bool(safe(lambda: m.protected_region, False)),
        "duration": safe(lambda: num(m.duration)),
        "comment": safe(lambda: m.comment),
        "label": safe(lambda: int(m.label)),
    }


TEXT_FIELDS = [
    ("text", "text"), ("font", "font"), ("fontSize", "font_size"),
    ("fillColor", "fill_color"), ("strokeColor", "stroke_color"),
    ("strokeWidth", "stroke_width"), ("applyFill", "apply_fill"),
    ("applyStroke", "apply_stroke"), ("strokeOverFill", "stroke_over_fill"),
    ("justification", "justification"), ("tracking", "tracking"),
    ("leading", "leading"), ("autoLeading", "auto_leading"),
    ("baselineShift", "baseline_shift"), ("horizontalScale", "horizontal_scale"),
    ("verticalScale", "vertical_scale"), ("tsume", "tsume"),
    ("fauxBold", "faux_bold"), ("fauxItalic", "faux_italic"),
    ("allCaps", "all_caps"), ("smallCaps", "small_caps"),
    ("superscript", "superscript"), ("subscript", "subscript"),
    ("boxText", "box_text"), ("boxTextSize", "box_text_size"),
    ("boxTextPos", "box_text_pos"), ("pointText", "point_text"),
    ("kerning", "kerning"), ("firstLineIndent", "first_line_indent"),
    ("startIndent", "start_indent"), ("endIndent", "end_indent"),
    ("spaceBefore", "space_before"), ("spaceAfter", "space_after"),
    ("direction", "direction"), ("lineJoinType", "line_join_type"),
    ("fontBaselineOption", "font_baseline_option"), ("fontCapsOption", "font_caps_option"),
    ("autoKernType", "auto_kern_type"), ("digitSet", "digit_set"),
    ("boxVerticalAlignment", "box_vertical_alignment"),
    ("ligature", "ligature"), ("hangingRoman", "hanging_roman"),
    ("noBreak", "no_break"), ("everyLineComposer", "every_line_composer"),
    ("baselineDirection", "baseline_direction"), ("leadingType", "leading_type"),
]


def enum_or_val(v):
    if v is None:
        return None
    n = getattr(v, "name", None)
    if n is not None and not isinstance(v, (bool, int)) or (n is not None and hasattr(v, "value")):
        return n
    return jv(v)


def text_json(t):
    d = {}
    for key, attr in TEXT_FIELDS:
        try:
            v = getattr(t, attr)
        except Exception as e:  # noqa: BLE001
            err(f"text.{attr}", e)
            v = None
        d[key] = enum_or_val(v)
    d["fontFamily"] = None
    d["fontStyle"] = None
    return d


def value_json(v):
    if v is None:
        return None
    if isinstance(v, Shape):
        return shape_json(v)
    if isinstance(v, TextDocument):
        return text_json(v)
    if isinstance(v, Gradient):
        return gradient_json(v)
    if isinstance(v, MarkerValue):
        return marker_json(v)
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return num(v)
    if isinstance(v, (list, tuple)):
        return [jv(i) for i in v]
    return None  # Curves etc.


def ease_json(lst):
    out = []
    for e in lst or []:
        out.append({"speed": num(e.speed), "influence": num(e.influence)})
    return out


def interp(x):
    return x.name if x is not None else None


def key_json(kf, prop, spatial):
    k = {}
    k["time"] = safe(lambda: num(kf.time), None, "key.time")
    k["value"] = safe(lambda: value_json(kf.value), None, "key.value")
    k["inInterpolation"] = safe(lambda: interp(kf.in_interpolation_type))
    k["outInterpolation"] = safe(lambda: interp(kf.out_interpolation_type))
    k["inTemporalEase"] = safe(lambda: ease_json(kf.in_temporal_ease), [])
    k["outTemporalEase"] = safe(lambda: ease_json(kf.out_temporal_ease), [])
    if spatial:
        k["spatialInTangent"] = safe(lambda: jv(kf.in_spatial_tangent))
        k["spatialOutTangent"] = safe(lambda: jv(kf.out_spatial_tangent))
    k["temporalContinuous"] = safe(lambda: bool(kf.temporal_continuous), False)
    k["temporalAutoBezier"] = safe(lambda: bool(kf.temporal_auto_bezier), False)
    k["spatialContinuous"] = safe(lambda: bool(kf.spatial_continuous), False)
    k["spatialAutoBezier"] = safe(lambda: bool(kf.spatial_auto_bezier), False)
    k["roving"] = safe(lambda: bool(kf.roving), False)
    return k


def is_effect_param(p):
    try:
        par = p.parent_property
        return par is not None and par.is_effect
    except Exception:
        return False


def prop_json(p, where):
    mn = p.match_name
    n = {"kind": "prop", "matchName": mn}
    if bool(getattr(getattr(p, "_tdbs", None), "synthetic", False)):
        n["synthetic"] = True
    n["name"] = safe(lambda: p.name, "", where + ".name")
    n["enabled"] = safe(lambda: bool(p.enabled), True)
    try:
        pvt = p.property_value_type
        vt = VALUE_TYPE.get(pvt, "CUSTOM")
    except Exception as e:  # noqa: BLE001
        err(where + ".valuetype", e)
        vt = "CUSTOM"
    value = None
    try:
        raw = p.value
        if isinstance(raw, Gradient):
            vt = "GRADIENT"
        value = value_json(raw)
        if vt == "CUSTOM":
            value = None
    except Exception as e:  # noqa: BLE001
        err(where + ".value", e)
        vt = "CUSTOM"
        value = None
    n["valueType"] = vt
    if is_effect_param(p):
        ct = safe(lambda: p.property_control_type)
        n["controlType"] = CONTROL_TYPE.get(ct, "NO_CONTROL") if ct is not None else None
    n["dimensions"] = DIMS.get(vt, 1 if vt in ("LAYER_INDEX", "MASK_INDEX") else 0)
    n["isSpatial"] = safe(lambda: bool(p.is_spatial), False)
    n["value"] = value
    keys = []
    try:
        for i, kf in enumerate(p.keyframes):
            keys.append(key_json(kf, p, n["isSpatial"]))
    except Exception as e:  # noqa: BLE001
        err(where + ".keyframes", e)
    if keys and vt == "MARKER":
        pass
    n["keyframes"] = keys
    if keys:
        n["value"] = keys[0]["value"]
    expr = safe(lambda: p.expression)
    n["expression"] = expr if expr else None
    n["expressionEnabled"] = bool(safe(lambda: p.expression_enabled, False)) and bool(expr)
    if safe(lambda: p.has_min, False):
        n["min"] = value_json(safe(lambda: p.min_value))
    if safe(lambda: p.has_max, False):
        n["max"] = value_json(safe(lambda: p.max_value))
    items = safe(lambda: p.property_parameters)
    if items:
        n["dropdownItems"] = list(items)
    if safe(lambda: p.dimensions_separated, False):
        n["dimensionsSeparated"] = True
    return n


def node_json(p, where):
    if isinstance(p, PropertyGroup):
        g = {
            "kind": "group",
            "matchName": p.match_name,
            "name": safe(lambda: p.name, ""),
            "enabled": safe(lambda: bool(p.enabled), True),
            "groupType": "indexed" if safe(lambda: p.property_type) == PropertyType.INDEXED_GROUP else "named",
            "children": [],
        }
        if bool(getattr(getattr(p, "_tdgp", None), "synthetic", False)):
            g["synthetic"] = True
        if getattr(p, "_is_mask", False):
            g["mask"] = {
                "mode": ["NONE", "ADD", "SUBTRACT", "INTERSECT", "LIGHTEN", "DARKEN", "DIFFERENCE"][max(0, min(6, int(p.mask_mode) - 6812))],
                "inverted": bool(p.inverted), "locked": bool(p.locked),
                "color": jv(safe(lambda: list(p.color))),
                "motionBlur": int(p._mkif.mask_motion_blur), "featherFalloff": int(p._mkif.mask_feather_falloff),
                "rotoBezier": bool(safe(lambda: p.roto_bezier, False)),
            }
            g["maskMode"] = g["mask"]["mode"]
            g["inverted"] = g["mask"]["inverted"]
            g["locked"] = g["mask"]["locked"]
            g["color"] = g["mask"]["color"]
            g["rotoBezier"] = g["mask"]["rotoBezier"]
        try:
            kids = list(p.properties)
        except Exception as e:  # noqa: BLE001
            err(where + ".children", e)
            kids = []
        for i, c in enumerate(kids):
            try:
                g["children"].append(node_json(c, f"{where}/{c.match_name}[{i}]"))
            except Exception as e:  # noqa: BLE001
                err(where + f"[{i}]", e)
                g["children"].append({"kind": "prop", "matchName": safe(lambda: c.match_name, "?"), "name": "", "enabled": True,
                                      "valueType": "CUSTOM", "dimensions": 0, "isSpatial": False, "value": None,
                                      "keyframes": [], "expression": None, "expressionEnabled": False})
        return g
    return prop_json(p, where)


LAYER_TYPES = {
    "AVLayer": "av", "TextLayer": "text", "ShapeLayer": "shape", "CameraLayer": "camera",
    "LightLayer": "light", "ThreeDModelLayer": "3dmodel", "ParametricMeshLayer": "mesh",
}


def layer_json(l, idx, comp):
    where = f"comp{comp.id}/L{l.id}"
    d = {}
    d["id"] = l.id
    d["index"] = idx + 1
    d["name"] = safe(lambda: l.name, "")
    d["type"] = LAYER_TYPES.get(type(l).__name__, "av")
    src = safe(lambda: l.source)
    d["sourceId"] = src.id if src is not None else None
    d["sourceKind"] = ("comp" if isinstance(src, CompItem) else "footage") if src is not None else None
    d["width"] = safe(lambda: l.width, 0)
    d["height"] = safe(lambda: l.height, 0)
    d["inPoint"] = safe(lambda: num(l.in_point))
    d["outPoint"] = safe(lambda: num(l.out_point))
    d["startTime"] = safe(lambda: num(l.start_time))
    d["stretch"] = safe(lambda: num(l.stretch))
    par = safe(lambda: l.parent)
    d["parentId"] = par.id if par is not None else None
    for k, a in [("enabled", "enabled"), ("solo", "solo"), ("shy", "shy"), ("locked", "locked"),
                 ("nullLayer", "null_layer"), ("adjustmentLayer", "adjustment_layer"),
                 ("threeD", "three_d_layer"), ("collapseTransformation", "collapse_transformation"),
                 ("guideLayer", "guide_layer"), ("motionBlur", "motion_blur"),
                 ("timeRemapEnabled", "time_remap_enabled")]:
        d[k] = bool(safe(lambda: getattr(l, a), False))
    ao = safe(lambda: l.auto_orient)
    d["autoOrient"] = ao.name if ao is not None else "NO_AUTO_ORIENT"
    bm = safe(lambda: l.blending_mode)
    d["blendMode"] = bm.name if bm is not None else "NORMAL"
    tm = safe(lambda: l.track_matte_type)
    d["trackMatteType"] = tm.name if tm is not None else "NO_TRACK_MATTE"
    ml = None
    if safe(lambda: l._matte_layer_id, 0):
        ml = l._matte_layer_id
    d["matteLayerId"] = ml
    d["essentialPropertyUuids"] = list(safe(lambda: l.essential_property_uuids, []) or [])
    props = []
    try:
        for i, c in enumerate(l.properties):
            try:
                props.append(node_json(c, f"{where}/{c.match_name}"))
            except Exception as e:  # noqa: BLE001
                err(where + f".prop[{i}]", e)
    except Exception as e:  # noqa: BLE001
        err(where + ".properties", e)
    d["properties"] = props
    d["markers"] = markers_of(safe(lambda: l.marker), where + ".markers")
    return d


def find_child(layer, path):
    """Resolve a controller path against py_aep layer, returns (path_out)."""
    return None


def footage_json(f):
    ms = safe(lambda: f.main_source)
    kind = "file"
    name = type(ms).__name__ if ms is not None else ""
    if name == "SolidSource":
        kind = "solid"
    elif name == "PlaceholderSource":
        kind = "placeholder"
    d = {
        "id": f.id, "name": f.name, "kind": kind,
        "path": "", "width": safe(lambda: f.width, 0), "height": safe(lambda: f.height, 0),
        "duration": safe(lambda: num(f.duration), 0), "frameRate": safe(lambda: num(f.frame_rate), 0),
        "hasVideo": bool(safe(lambda: f.has_video, True)), "hasAudio": bool(safe(lambda: f.has_audio, False)),
    }
    if kind == "file":
        d["path"] = safe(lambda: str(f.file) if f.file else "", "")
    if kind == "solid":
        d["color"] = jv(safe(lambda: list(ms.color)))
    return d


import struct

CTRL_TYPES = {1: "checkbox", 2: "slider", 4: "color", 5: "point", 6: "text", 8: "comment",
              9: "multidim", 10: "group", 13: "dropdown", 14: "media"}


def _raw_ctl_values(cctl):
    """Parse raw LIST:CCtl chunk -> dict of default/value/min/max."""
    from py_aep.binary.chunk import ListChunk
    kids = {}
    utf8 = []
    for k in cctl.chunks:
        if isinstance(k, ListChunk):
            continue
        if k.chunk_type == "Utf8":
            utf8.append(k.value)
        else:
            kids.setdefault(k.chunk_type, k)
    ty = kids["CTyp"].value if "CTyp" in kids else None

    def raw(k):
        return k.tobytes() if k is not None else None

    def decode(b):
        if b is None:
            return None
        if ty == 1:
            return bool(b[0]) if b else None
        if ty == 4 and len(b) == 16:
            return list(struct.unpack(">4f", b))
        if len(b) % 8 == 0 and len(b) >= 8:
            v = list(struct.unpack(">%dd" % (len(b) // 8), b))
            return v[0] if len(v) == 1 else v
        return None
    out = {"value": decode(raw(kids.get("CVal"))), "default": decode(raw(kids.get("CDef"))),
           "min": decode(raw(kids.get("Smin"))), "max": decode(raw(kids.get("Smax")))}
    if ty == 6 and len(utf8) >= 2:
        out["value"] = utf8[1]
        out["default"] = utf8[2] if len(utf8) > 2 else utf8[1]
    return out


def _walk_path(comp, layer, refs):
    """Resolve controller path -> (property, path list) or (None, None)."""
    from py_aep.resolvers.essential_properties import _walk_source_property
    prop = _walk_source_property(layer, refs)
    if prop is None:
        return None, None
    chain = []
    node = prop
    while node is not None and node is not layer:
        chain.append(node)
        node = node.parent_property
    chain.reverse()
    path = []
    parent = layer
    for n in chain:
        if parent.property_type == PropertyType.INDEXED_GROUP:
            path.append(list(parent.properties).index(n))
        else:
            path.append(n.match_name)
        parent = n
    return prop, path


def controllers_json(comp):
    from py_aep.binary.chunk import ListChunk
    out = []
    ctrls = safe(lambda: comp.motion_graphics_controllers, [], f"comp{comp.id}.controllers") or []
    raw = []
    for ch in comp._item_list.chunks:
        if isinstance(ch, ListChunk) and ch.list_type in ("CIF3", "CIF2", "CIFO"):
            raw = [k for k in ch.chunks if isinstance(k, ListChunk) and k.list_type == "CCtl"]
            if ch.list_type == "CIF3":
                break
    group_name = None
    for i, c in enumerate(ctrls):
        ct = safe(lambda: int(c.controller_type))
        d = {
            "uuid": c.uuid, "name": safe(lambda: c.name, ""),
            "type": CTRL_TYPES.get(ct, "type%s" % ct), "controllerType": ct,
            "layerId": c.source_layer_id, "propertyPath": None,
            "defaultValue": None,
        }
        rv = safe(lambda: _raw_ctl_values(raw[i]), {}, f"comp{comp.id}.ctl{i}") if i < len(raw) else {}
        d["defaultValue"] = rv.get("default")
        d["value"] = rv.get("value")
        if rv.get("min") is not None:
            d["min"] = rv["min"]
        if rv.get("max") is not None:
            d["max"] = rv["max"]
        if ct == 10:
            group_name = d["name"]
        elif group_name is not None:
            d["groupName"] = group_name
        layer = comp.layers_by_id.get(c.source_layer_id) if c.source_layer_id is not None else None
        if layer is not None and c.source_property_path:
            prop, path = safe(lambda: _walk_path(comp, layer, c.source_property_path), (None, None), f"comp{comp.id}.ctlpath{i}")
            if path is not None:
                d["propertyPath"] = path
                if isinstance(prop, Property):
                    items = safe(lambda: prop.property_parameters)
                    if items:
                        d["dropdownItems"] = list(items)
        elif layer is not None and ct == 14:
            d["propertyPath"] = ["ADBE Source Options Group", "ADBE Layer Source Alternate"]
        d["sourcePath"] = [{"matchName": r.match_name, "index": r.prop_index} for r in c.source_property_path]
        out.append(d)
    return out

def markers_of(prop, where):
    out = []
    if prop is None:
        return out
    try:
        for kf in prop.keyframes:
            out.append(marker_json(kf.value, safe(lambda: num(kf.time))))
    except Exception as e:  # noqa: BLE001
        err(where, e)
    return out


def comp_json(c):
    d = {
        "id": c.id, "name": c.name, "width": c.width, "height": c.height,
        "pixelAspect": num(c.pixel_aspect), "frameRate": num(c.frame_rate), "duration": num(c.duration),
        "displayStartTime": safe(lambda: num(c.display_start_time)),
        "bgColor": jv(safe(lambda: list(c.bg_color), [0, 0, 0])),
        "workAreaStart": safe(lambda: num(c.work_area_start)),
        "workAreaDuration": safe(lambda: num(c.work_area_duration)),
    }
    layers = []
    for i, l in enumerate(c.layers):
        try:
            layers.append(layer_json(l, i, c))
        except Exception as e:  # noqa: BLE001
            err(f"comp{c.id}.layer[{i}]", e)
    d["layers"] = layers
    d["markers"] = markers_of(safe(lambda: c.marker_property), f"comp{c.id}.markers")
    d["essentialControllers"] = controllers_json(c)
    return d


def convert(path):
    app = parse(path)
    proj = app.project
    scene = {
        "version": 1,
        "comps": [],
        "footage": [],
        "usedFonts": [],
        "expressionEngine": safe(lambda: proj.expression_engine, "") or "",
    }
    for it in proj.items.values():
        if isinstance(it, CompItem):
            try:
                scene["comps"].append(comp_json(it))
            except Exception as e:  # noqa: BLE001
                err(f"comp {it.id}", e)
                traceback.print_exc()
        elif isinstance(it, FootageItem):
            try:
                scene["footage"].append(footage_json(it))
            except Exception as e:  # noqa: BLE001
                err(f"footage {it.id}", e)
    try:
        uf = proj.used_fonts
        scene["usedFonts"] = sorted({str(getattr(f.get("font") if isinstance(f, dict) else f, "post_script_name", "")) for f in uf} - {""})
    except Exception as e:  # noqa: BLE001
        err("usedFonts", e)
    scene["comps"].sort(key=lambda c: c["id"])
    scene["footage"].sort(key=lambda c: c["id"])
    return scene


def main():
    if len(sys.argv) < 2:
        print(__doc__)
        sys.exit(2)
    src = sys.argv[1]
    out = sys.argv[2] if len(sys.argv) > 2 else None
    scene = convert(src)
    scene["_oracleErrors"] = ERRORS[:200]
    text = json.dumps(scene, indent=1, ensure_ascii=False)
    if out:
        with open(out, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"wrote {out}: {len(scene['comps'])} comps, {len(scene['footage'])} footage, {len(ERRORS)} errors")
    else:
        sys.stdout.write(text)


if __name__ == "__main__":
    main()






