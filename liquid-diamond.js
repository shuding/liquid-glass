;(function () {
  'use strict'

  if (window.attachLiquidPyramid) {
    return
  }

  const WIDTH = 220
  const HEIGHT = 220
  const VIEWPORT_SCALE = 1.7
  const CAMERA = [0, 0.08, 4.2]
  const BACKGROUND_Z = -5.5
  const IOR = 1.18
  const MAX_DISTANCE = 12
  const SURFACE_OFFSET = 0.008
  const MIN_BACKGROUND_Z_COMPONENT = 0.08
  const MAX_UV_OFFSET = 2
  const MAX_EFFECTIVE_UV_OFFSET = 0.32
  const MAX_INTERNAL_BOUNCES = 8
  const EDGE_BULGE_PX = 20
  const EDGE_BULGE_STRENGTH = 0.04
  const CANVAS_DPI = 1.25
  const DRAG_ELASTIC = 0.16
  const VELOCITY_DAMPING = 0.94
  const BOUND_SPRING = 0.014
  const BOUND_DAMPING = 0.82
  const THETA_PER_PX = 0.0125
  const PHI_PER_PX = 0.01
  const PHI_MIN = -1.35
  const PHI_MAX = 1.35

  function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value))
  }

  function texture(x, y) {
    return [x, y]
  }

  function add3(a, b) {
    return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
  }

  function sub3(a, b) {
    return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  }

  function mul3(a, scalar) {
    return [a[0] * scalar, a[1] * scalar, a[2] * scalar]
  }

  function dot3(a, b) {
    return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
  }

  function cross3(a, b) {
    return [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ]
  }

  function length3(v) {
    return Math.hypot(v[0], v[1], v[2])
  }

  function normalize3(v) {
    const len = length3(v)
    if (!len) {
      return [0, 0, 0]
    }
    return [v[0] / len, v[1] / len, v[2] / len]
  }

  function softClampSigned(value, limit) {
    if (Math.abs(value) <= limit) {
      return value
    }
    return limit * Math.tanh(value / limit)
  }

  function stabilizeBackgroundDirection(direction, minZ) {
    if (direction[2] <= -minZ) {
      return direction
    }
    return normalize3([direction[0], direction[1], -minZ])
  }

  function buildDisplacementTrace(
    uv,
    origin,
    direction,
    entryPoint,
    exitPoint,
  ) {
    const finalExitPoint = exitPoint || entryPoint
    const stableDirection = stabilizeBackgroundDirection(
      direction,
      MIN_BACKGROUND_Z_COMPONENT,
    )
    const hit = traceToPlane(origin, stableDirection, BACKGROUND_Z)
    if (!hit) {
      return { displacedUv: { x: uv.x, y: uv.y } }
    }

    const displacedUv = screenPointToUv(hit)
    let offsetX = displacedUv.x - uv.x
    let offsetY = displacedUv.y - uv.y
    offsetX = clamp(offsetX, -MAX_UV_OFFSET, MAX_UV_OFFSET)
    offsetY = clamp(offsetY, -MAX_UV_OFFSET, MAX_UV_OFFSET)

    const strength = clamp(
      0.9 + length3(sub3(finalExitPoint, entryPoint)) * 0.14,
      0.85,
      1.25,
    )

    return {
      displacedUv: {
        x: uv.x + softClampSigned(offsetX * strength, MAX_EFFECTIVE_UV_OFFSET),
        y: uv.y + softClampSigned(offsetY * strength, MAX_EFFECTIVE_UV_OFFSET),
      },
    }
  }

  function rotatePointWithTransform(point, transform) {
    const yx = point[0] * transform.thetaCos + point[2] * transform.thetaSin
    const yz = -point[0] * transform.thetaSin + point[2] * transform.thetaCos

    return [
      yx,
      point[1] * transform.phiCos - yz * transform.phiSin,
      point[1] * transform.phiSin + yz * transform.phiCos,
    ]
  }

  function inverseRotatePointWithTransform(point, transform) {
    const xx = point[0]
    const xy = point[1] * transform.phiCos + point[2] * transform.phiSin
    const xz = -point[1] * transform.phiSin + point[2] * transform.phiCos

    return [
      xx * transform.thetaCos - xz * transform.thetaSin,
      xy,
      xx * transform.thetaSin + xz * transform.thetaCos,
    ]
  }

  function createPlane(a, b, c, interiorPoint) {
    let normal = normalize3(cross3(sub3(b, a), sub3(c, a)))
    if (dot3(sub3(interiorPoint, a), normal) > 0) {
      normal = mul3(normal, -1)
    }
    return { point: a, normal }
  }

  function scaleVertices(vertices, scale) {
    return {
      apex: mul3(vertices.apex, scale),
      base: vertices.base.map((vertex) => mul3(vertex, scale)),
    }
  }

  const BASE_PYRAMID_VERTICES = {
    apex: [0, 1.18, 0],
    base: [
      [-1.04, -0.92, -1.04],
      [1.04, -0.92, -1.04],
      [1.04, -0.92, 1.04],
      [-1.04, -0.92, 1.04],
    ],
  }
  const SHAPE_SCALE = 0.9
  const PYRAMID_VERTICES = scaleVertices(BASE_PYRAMID_VERTICES, SHAPE_SCALE)
  const PYRAMID_INTERIOR = mul3([0, -0.3, 0], SHAPE_SCALE)
  const PYRAMID_PLANES = [
    createPlane(
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[0],
      PYRAMID_VERTICES.base[1],
      PYRAMID_INTERIOR,
    ),
    createPlane(
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[1],
      PYRAMID_VERTICES.base[2],
      PYRAMID_INTERIOR,
    ),
    createPlane(
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[2],
      PYRAMID_VERTICES.base[3],
      PYRAMID_INTERIOR,
    ),
    createPlane(
      PYRAMID_VERTICES.apex,
      PYRAMID_VERTICES.base[3],
      PYRAMID_VERTICES.base[0],
      PYRAMID_INTERIOR,
    ),
    createPlane(
      PYRAMID_VERTICES.base[0],
      PYRAMID_VERTICES.base[3],
      PYRAMID_VERTICES.base[2],
      PYRAMID_INTERIOR,
    ),
  ]
  const PYRAMID_FACES = [
    {
      vertices: [
        PYRAMID_VERTICES.apex,
        PYRAMID_VERTICES.base[0],
        PYRAMID_VERTICES.base[1],
      ],
      normal: PYRAMID_PLANES[0].normal,
    },
    {
      vertices: [
        PYRAMID_VERTICES.apex,
        PYRAMID_VERTICES.base[1],
        PYRAMID_VERTICES.base[2],
      ],
      normal: PYRAMID_PLANES[1].normal,
    },
    {
      vertices: [
        PYRAMID_VERTICES.apex,
        PYRAMID_VERTICES.base[2],
        PYRAMID_VERTICES.base[3],
      ],
      normal: PYRAMID_PLANES[2].normal,
    },
    {
      vertices: [
        PYRAMID_VERTICES.apex,
        PYRAMID_VERTICES.base[3],
        PYRAMID_VERTICES.base[0],
      ],
      normal: PYRAMID_PLANES[3].normal,
    },
    {
      vertices: [
        PYRAMID_VERTICES.base[0],
        PYRAMID_VERTICES.base[1],
        PYRAMID_VERTICES.base[2],
      ],
      normal: PYRAMID_PLANES[4].normal,
    },
    {
      vertices: [
        PYRAMID_VERTICES.base[0],
        PYRAMID_VERTICES.base[2],
        PYRAMID_VERTICES.base[3],
      ],
      normal: PYRAMID_PLANES[4].normal,
    },
  ]

  function intersectRayTriangle(origin, direction, a, b, c, normal) {
    const edge1 = sub3(b, a)
    const edge2 = sub3(c, a)
    const pvec = cross3(direction, edge2)
    const det = dot3(edge1, pvec)
    if (Math.abs(det) < 1e-6) {
      return null
    }

    const invDet = 1 / det
    const tvec = sub3(origin, a)
    const u = dot3(tvec, pvec) * invDet
    if (u < 0 || u > 1) {
      return null
    }

    const qvec = cross3(tvec, edge1)
    const v = dot3(direction, qvec) * invDet
    if (v < 0 || u + v > 1) {
      return null
    }

    const t = dot3(edge2, qvec) * invDet
    if (t <= SURFACE_OFFSET || t > MAX_DISTANCE) {
      return null
    }

    return {
      t,
      point: add3(origin, mul3(direction, t)),
      normal,
    }
  }

  function intersectCrystalFaces(origin, direction, transform) {
    const localOrigin = inverseRotatePointWithTransform(origin, transform)
    const localDirection = inverseRotatePointWithTransform(direction, transform)
    let bestHit = null

    for (let i = 0; i < PYRAMID_FACES.length; i += 1) {
      const face = PYRAMID_FACES[i]
      const hit = intersectRayTriangle(
        localOrigin,
        localDirection,
        face.vertices[0],
        face.vertices[1],
        face.vertices[2],
        face.normal,
      )
      if (!hit) {
        continue
      }
      if (!bestHit || hit.t < bestHit.t) {
        bestHit = {
          t: hit.t,
          point: rotatePointWithTransform(hit.point, transform),
          normal: normalize3(rotatePointWithTransform(hit.normal, transform)),
        }
      }
    }

    return bestHit
  }

  function refractVector(incident, normal, ratio) {
    const orientedNormal =
      dot3(incident, normal) < 0 ? normal : mul3(normal, -1)
    const cosTheta = dot3(orientedNormal, incident)
    const k = 1 - ratio * ratio * (1 - cosTheta * cosTheta)
    if (k < 0) {
      return null
    }
    return normalize3(
      sub3(
        mul3(incident, ratio),
        mul3(orientedNormal, ratio * cosTheta + Math.sqrt(k)),
      ),
    )
  }

  function reflectVector(incident, normal) {
    const orientedNormal =
      dot3(incident, normal) < 0 ? normal : mul3(normal, -1)
    return normalize3(
      sub3(incident, mul3(orientedNormal, 2 * dot3(incident, orientedNormal))),
    )
  }

  function traceToPlane(origin, direction, planeZ) {
    if (Math.abs(direction[2]) < 1e-5) {
      return null
    }
    const t = (planeZ - origin[2]) / direction[2]
    if (t <= 0) {
      return null
    }
    return add3(origin, mul3(direction, t))
  }

  function uvToScreenPoint(uv) {
    return [
      (uv.x - 0.5) * 2 * VIEWPORT_SCALE,
      (0.5 - uv.y) * 2 * VIEWPORT_SCALE,
      0,
    ]
  }

  function screenPointToUv(point) {
    return {
      x: point[0] / (2 * VIEWPORT_SCALE) + 0.5,
      y: 0.5 - point[1] / (2 * VIEWPORT_SCALE),
    }
  }

  function projectPoint(point) {
    const depth = CAMERA[2] - point[2]
    const factor = CAMERA[2] / depth
    return [point[0] * factor, point[1] * factor]
  }

  function comparePoints(a, b) {
    if (a.x !== b.x) {
      return a.x - b.x
    }
    return a.y - b.y
  }

  function cross2(o, a, b) {
    return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x)
  }

  function length2(x, y) {
    return Math.hypot(x, y)
  }

  function centroid2(points) {
    let x = 0
    let y = 0
    for (let i = 0; i < points.length; i += 1) {
      x += points[i].x
      y += points[i].y
    }
    return { x: x / points.length, y: y / points.length }
  }

  function bounds2(points) {
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity

    for (let i = 0; i < points.length; i += 1) {
      const point = points[i]
      minX = Math.min(minX, point.x)
      minY = Math.min(minY, point.y)
      maxX = Math.max(maxX, point.x)
      maxY = Math.max(maxY, point.y)
    }

    return {
      minX: minX,
      minY: minY,
      maxX: maxX,
      maxY: maxY,
      width: maxX - minX,
      height: maxY - minY,
    }
  }

  function selectBloomAnchors(points) {
    let top = points[0]
    let lowerLeft = points[0]
    let lowerRight = points[0]

    for (let i = 1; i < points.length; i += 1) {
      const point = points[i]
      if (point.y < top.y) {
        top = point
      }
      if (point.x + point.y < lowerLeft.x + lowerLeft.y) {
        lowerLeft = point
      }
      if (point.x - point.y > lowerRight.x - lowerRight.y) {
        lowerRight = point
      }
    }

    return {
      top: top,
      lowerLeft: lowerLeft,
      lowerRight: lowerRight,
    }
  }

  function buildHullEdges(hull) {
    const edges = []
    for (let i = 0; i < hull.length; i += 1) {
      const a = hull[i]
      const b = hull[(i + 1) % hull.length]
      const abx = b.x - a.x
      const aby = b.y - a.y
      edges.push({
        a,
        abx,
        aby,
        ab2: abx * abx + aby * aby,
      })
    }
    return edges
  }

  function pointEdgeDistance(point, edge) {
    if (!edge.ab2) {
      return length2(point.x - edge.a.x, point.y - edge.a.y)
    }

    const apx = point.x - edge.a.x
    const apy = point.y - edge.a.y
    const t = clamp((apx * edge.abx + apy * edge.aby) / edge.ab2, 0, 1)
    const closestX = edge.a.x + edge.abx * t
    const closestY = edge.a.y + edge.aby * t
    return length2(point.x - closestX, point.y - closestY)
  }

  function smoothStep(a, b, t) {
    const x = clamp((t - a) / (b - a), 0, 1)
    return x * x * (3 - 2 * x)
  }

  function convexHull(points) {
    const sorted = points.slice().sort(comparePoints)
    if (sorted.length <= 1) {
      return sorted
    }

    const lower = []
    for (let i = 0; i < sorted.length; i += 1) {
      const point = sorted[i]
      while (
        lower.length >= 2 &&
        cross2(lower[lower.length - 2], lower[lower.length - 1], point) <= 0
      ) {
        lower.pop()
      }
      lower.push(point)
    }

    const upper = []
    for (let i = sorted.length - 1; i >= 0; i -= 1) {
      const point = sorted[i]
      while (
        upper.length >= 2 &&
        cross2(upper[upper.length - 2], upper[upper.length - 1], point) <= 0
      ) {
        upper.pop()
      }
      upper.push(point)
    }

    lower.pop()
    upper.pop()
    return lower.concat(upper)
  }

  function createProjectedHull(transform) {
    const projected = [PYRAMID_VERTICES.apex]
      .concat(PYRAMID_VERTICES.base)
      .map(function (vertex) {
        const rotated = rotatePointWithTransform(vertex, transform)
        const projectedPoint = projectPoint(rotated)
        return {
          x: (projectedPoint[0] / VIEWPORT_SCALE) * (WIDTH / 2) + WIDTH / 2,
          y: HEIGHT / 2 - (projectedPoint[1] / VIEWPORT_SCALE) * (HEIGHT / 2),
        }
      })

    return convexHull(projected)
  }

  function createProjectedFaces(transform) {
    return PYRAMID_FACES.map(function (face) {
      const worldVertices = face.vertices.map(function (vertex) {
        return rotatePointWithTransform(vertex, transform)
      })
      const points = worldVertices.map(function (vertex) {
        const projectedPoint = projectPoint(vertex)
        return {
          x: (projectedPoint[0] / VIEWPORT_SCALE) * (WIDTH / 2) + WIDTH / 2,
          y: HEIGHT / 2 - (projectedPoint[1] / VIEWPORT_SCALE) * (HEIGHT / 2),
        }
      })
      const centroid = mul3(
        add3(add3(worldVertices[0], worldVertices[1]), worldVertices[2]),
        1 / 3,
      )
      const rotatedNormal = normalize3(
        rotatePointWithTransform(face.normal, transform),
      )
      const viewDirection = normalize3(sub3(CAMERA, centroid))
      const facing = Math.abs(dot3(rotatedNormal, viewDirection))

      return {
        points: points,
        strokeOpacity: 0.09 + facing * 0.14,
        fillOpacity: 0.012 + facing * 0.028,
      }
    })
  }

  function createPyramidContext(theta, phi) {
    const transform = {
      theta: theta,
      phi: phi,
      thetaCos: Math.cos(theta),
      thetaSin: Math.sin(theta),
      phiCos: Math.cos(phi),
      phiSin: Math.sin(phi),
    }
    const hull = createProjectedHull(transform)
    const projectedFaces = createProjectedFaces(transform)
    const hullCenter = centroid2(hull)
    const hullBounds = bounds2(hull)
    const bloomAnchors = selectBloomAnchors(hull)
    const hullEdges = buildHullEdges(hull)

    return {
      theta: theta,
      phi: phi,
      thetaCos: transform.thetaCos,
      thetaSin: transform.thetaSin,
      phiCos: transform.phiCos,
      phiSin: transform.phiSin,
      hull: hull,
      projectedFaces: projectedFaces,
      hullCenter: hullCenter,
      hullBounds: hullBounds,
      bloomAnchors: bloomAnchors,
      hullEdges: hullEdges,
      clipPath:
        'polygon(' +
        hull
          .map(function (point) {
            return point.x.toFixed(2) + 'px ' + point.y.toFixed(2) + 'px'
          })
          .join(', ') +
        ')',
    }
  }

  function tracePyramidRay(uv, context) {
    const screenPoint = uvToScreenPoint(uv)
    const rayDirection = normalize3(sub3(screenPoint, CAMERA))
    const firstHit = intersectCrystalFaces(CAMERA, rayDirection, context)
    if (!firstHit) {
      return null
    }
    const entryPoint = firstHit.point

    const insideDirection = refractVector(
      rayDirection,
      firstHit.normal,
      1 / IOR,
    )
    if (!insideDirection) {
      return buildDisplacementTrace(
        uv,
        add3(entryPoint, mul3(rayDirection, SURFACE_OFFSET)),
        reflectVector(rayDirection, firstHit.normal),
        entryPoint,
      )
    }

    let insideOrigin = add3(entryPoint, mul3(insideDirection, SURFACE_OFFSET))
    let currentDirection = insideDirection
    let exitPoint = null
    let outsideDirection = null

    for (let bounce = 0; bounce < MAX_INTERNAL_BOUNCES; bounce += 1) {
      const insideHit = intersectCrystalFaces(
        insideOrigin,
        currentDirection,
        context,
      )
      if (!insideHit) {
        return buildDisplacementTrace(
          uv,
          insideOrigin,
          currentDirection,
          entryPoint,
        )
      }

      exitPoint = insideHit.point
      outsideDirection = refractVector(currentDirection, insideHit.normal, IOR)
      if (outsideDirection) {
        break
      }

      currentDirection = reflectVector(currentDirection, insideHit.normal)
      insideOrigin = add3(exitPoint, mul3(currentDirection, SURFACE_OFFSET))
    }

    if (!exitPoint || !outsideDirection) {
      return buildDisplacementTrace(
        uv,
        insideOrigin,
        currentDirection,
        entryPoint,
      )
    }

    return buildDisplacementTrace(
      uv,
      add3(exitPoint, mul3(outsideDirection, SURFACE_OFFSET)),
      outsideDirection,
      entryPoint,
      exitPoint,
    )
  }

  function applyEdgeBulge(trace, uv, context) {
    const pixelPoint = {
      x: uv.x * WIDTH,
      y: uv.y * HEIGHT,
    }

    let edgeDistance = Infinity
    for (let i = 0; i < context.hullEdges.length; i += 1) {
      edgeDistance = Math.min(
        edgeDistance,
        pointEdgeDistance(pixelPoint, context.hullEdges[i]),
      )
    }

    const edgeWeight = 1 - smoothStep(0, EDGE_BULGE_PX, edgeDistance)
    if (edgeWeight <= 0) {
      return trace
    }

    const centerUv = {
      x: context.hullCenter.x / WIDTH,
      y: context.hullCenter.y / HEIGHT,
    }

    return {
      displacedUv: {
        x:
          trace.displacedUv.x +
          (centerUv.x - uv.x) * edgeWeight * EDGE_BULGE_STRENGTH,
        y:
          trace.displacedUv.y +
          (centerUv.y - uv.y) * edgeWeight * EDGE_BULGE_STRENGTH,
      },
    }
  }

  function createShader(width, height, options) {
    const id = 'liquid-pyramid-' + Math.random().toString(36).slice(2)
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    const defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs')
    const filter = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'filter',
    )
    const feImage = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'feImage',
    )
    const feDisplacementMap = document.createElementNS(
      'http://www.w3.org/2000/svg',
      'feDisplacementMap',
    )

    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
    svg.setAttribute('width', '0')
    svg.setAttribute('height', '0')
    svg.style.display = 'none'

    filter.setAttribute('id', id + '-filter')
    filter.setAttribute('filterUnits', 'userSpaceOnUse')
    filter.setAttribute('color-interpolation-filters', 'sRGB')
    filter.setAttribute('x', '0')
    filter.setAttribute('y', '0')
    filter.setAttribute('width', String(width))
    filter.setAttribute('height', String(height))

    feImage.setAttribute('result', 'map')
    feImage.setAttribute('width', String(width))
    feImage.setAttribute('height', String(height))

    feDisplacementMap.setAttribute('in', 'SourceGraphic')
    feDisplacementMap.setAttribute('in2', 'map')
    feDisplacementMap.setAttribute('xChannelSelector', 'R')
    feDisplacementMap.setAttribute('yChannelSelector', 'G')

    filter.appendChild(feImage)
    filter.appendChild(feDisplacementMap)
    defs.appendChild(filter)
    svg.appendChild(defs)

    const root = document.createElement('div')
    root.style.position = 'relative'
    root.style.width = width + 'px'
    root.style.height = height + 'px'
    root.style.overflow = 'visible'

    const bloom = document.createElement('div')
    bloom.style.position = 'absolute'
    bloom.style.inset = '0'
    bloom.style.pointerEvents = 'none'
    root.appendChild(bloom)

    const rim = document.createElement('div')
    rim.style.position = 'absolute'
    rim.style.inset = '0'
    rim.style.pointerEvents = 'none'
    root.appendChild(rim)

    const edgeSvg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
    edgeSvg.setAttribute('width', String(width))
    edgeSvg.setAttribute('height', String(height))
    edgeSvg.setAttribute('viewBox', '0 0 ' + width + ' ' + height)
    edgeSvg.style.position = 'absolute'
    edgeSvg.style.inset = '0'
    edgeSvg.style.overflow = 'visible'
    edgeSvg.style.pointerEvents = 'none'
    root.appendChild(edgeSvg)

    const shell = document.createElement('div')
    shell.style.position = 'absolute'
    shell.style.top = '0'
    shell.style.left = '0'
    shell.style.width = width + 'px'
    shell.style.height = height + 'px'
    shell.style.overflow = 'visible'
    root.appendChild(shell)

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(width * CANVAS_DPI)
    canvas.height = Math.round(height * CANVAS_DPI)
    canvas.style.position = 'absolute'
    canvas.style.left = '10px'
    canvas.style.bottom = '10px'
    canvas.style.width = width + 'px'
    canvas.style.height = height + 'px'
    canvas.style.display = options.debug ? 'inline-block' : 'none'
    root.appendChild(canvas)

    const debugLabel = document.createElement('div')
    debugLabel.style.position = 'absolute'
    debugLabel.style.left = '10px'
    debugLabel.style.bottom = height + 20 + 'px'
    debugLabel.style.display = options.debug ? 'block' : 'none'
    debugLabel.style.color = 'white'
    debugLabel.style.fontSize = '12px'
    debugLabel.style.textShadow = '0 1px 4px rgba(0, 0, 0, 0.6)'
    root.appendChild(debugLabel)

    const context2d = canvas.getContext('2d')
    let fragment = null
    let raf = 0
    let rawValues = null
    let imageData = null

    function render() {
      raf = 0
      if (!fragment) {
        return
      }

      const w = canvas.width
      const h = canvas.height
      if (!imageData || imageData.width !== w || imageData.height !== h) {
        imageData = new ImageData(w, h)
      }
      if (!rawValues || rawValues.length !== w * h * 2) {
        rawValues = new Float32Array(w * h * 2)
      }

      const data = imageData.data
      let maxScale = 0
      let valueIndex = 0

      for (let i = 0; i < data.length; i += 4) {
        const x = (i / 4) % w
        const y = ~~(i / 4 / w)
        const pos = fragment({
          x: x / w,
          y: y / h,
        })
        const dx = pos[0] * w - x
        const dy = pos[1] * h - y
        if (Math.abs(dx) > maxScale) maxScale = Math.abs(dx)
        if (Math.abs(dy) > maxScale) maxScale = Math.abs(dy)
        rawValues[valueIndex++] = dx
        rawValues[valueIndex++] = dy
      }

      maxScale = Math.max(maxScale, 1)
      let index = 0
      for (let i = 0; i < data.length; i += 4) {
        const r = rawValues[index++] / (maxScale * 2) + 0.5
        const g = rawValues[index++] / (maxScale * 2) + 0.5
        data[i] = r * 256
        data[i + 1] = g * 256
        data[i + 2] = 0
        data[i + 3] = 255
      }

      context2d.putImageData(imageData, 0, 0)
      feImage.setAttribute('href', canvas.toDataURL())
      feDisplacementMap.setAttribute(
        'scale',
        String((maxScale * 2) / CANVAS_DPI),
      )
      debugLabel.textContent =
        'Displacement Map (scale = ' + maxScale.toFixed(2) + ')'
    }

    function scheduleRender() {
      if (!raf) {
        raf = requestAnimationFrame(render)
      }
    }

    return {
      element: root,
      svg: svg,
      bloom: bloom,
      rim: rim,
      edgeSvg: edgeSvg,
      shell: shell,
      debugLabel: debugLabel,
      setFragment: function (nextFragment) {
        fragment = nextFragment
        scheduleRender()
      },
      setStyle: function (style) {
        shell.style.backdropFilter =
          'url(#' +
          id +
          '-filter) contrast(1.08) brightness(1.2) saturate(1.08)'
        shell.style.webkitBackdropFilter = shell.style.backdropFilter
        shell.style.width = width + 'px'
        shell.style.height = height + 'px'
        for (const key in style) {
          shell.style[key] = style[key]
        }
      },
      setBloomStyle: function (style) {
        bloom.style.width = width + 'px'
        bloom.style.height = height + 'px'
        for (const key in style) {
          bloom.style[key] = style[key]
        }
      },
      setRimStyle: function (style) {
        rim.style.width = width + 'px'
        rim.style.height = height + 'px'
        for (const key in style) {
          rim.style[key] = style[key]
        }
      },
      setFaceOverlay: function (faces) {
        edgeSvg.replaceChildren()
        for (let i = 0; i < faces.length; i += 1) {
          const face = faces[i]
          const polygon = document.createElementNS(
            'http://www.w3.org/2000/svg',
            'polygon',
          )
          polygon.setAttribute(
            'points',
            face.points
              .map(function (point) {
                return point.x.toFixed(2) + ',' + point.y.toFixed(2)
              })
              .join(' '),
          )
          polygon.setAttribute(
            'fill',
            'rgba(188, 232, 247, ' + face.fillOpacity.toFixed(3) + ')',
          )
          polygon.setAttribute(
            'stroke',
            'rgba(126, 176, 198, ' + face.strokeOpacity.toFixed(3) + ')',
          )
          polygon.setAttribute('stroke-width', '1')
          polygon.setAttribute('stroke-linejoin', 'round')
          polygon.setAttribute('vector-effect', 'non-scaling-stroke')
          edgeSvg.appendChild(polygon)
        }
      },
      mount: function (parent) {
        parent.appendChild(svg)
        parent.appendChild(root)
      },
      destroy: function () {
        if (raf) {
          cancelAnimationFrame(raf)
        }
        svg.remove()
        root.remove()
      },
    }
  }

  function attachLiquidPyramid(options) {
    const opts = Object.assign(
      {
        parent: document.body,
        debug: false,
      },
      options || {},
    )

    const parent = opts.parent
    const mount = document.createElement('div')
    mount.style.position = 'fixed'
    mount.style.left = '0'
    mount.style.top = '0'
    mount.style.width = '100vw'
    mount.style.height = '100vh'
    mount.style.pointerEvents = 'none'
    mount.style.zIndex = '9999'
    parent.appendChild(mount)

    const interactionLayer = document.createElement('div')
    interactionLayer.style.position = 'absolute'
    interactionLayer.style.inset = '0'
    interactionLayer.style.pointerEvents = 'none'
    mount.appendChild(interactionLayer)

    const shader = createShader(WIDTH, HEIGHT, { debug: opts.debug })
    const host = document.createElement('div')
    host.style.position = 'absolute'
    host.style.left = '50%'
    host.style.top = '50%'
    host.style.width = WIDTH + 'px'
    host.style.height = HEIGHT + 'px'
    host.style.pointerEvents = 'auto'
    host.style.cursor = 'grab'
    host.style.touchAction = 'none'
    interactionLayer.appendChild(host)
    shader.mount(host)

    let x = 0
    let y = 0
    let vx = 0
    let vy = 0
    let dragging = false
    let pointerId = null
    let dragStartX = 0
    let dragStartY = 0
    let dragOriginX = 0
    let dragOriginY = 0
    let lastPointerX = 0
    let lastPointerY = 0
    let lastPointerTime = 0
    let animationFrame = 0

    function bounds() {
      return {
        minX: -(window.innerWidth - WIDTH) / 2,
        maxX: (window.innerWidth - WIDTH) / 2,
        minY: -(window.innerHeight - HEIGHT) / 2,
        maxY: (window.innerHeight - HEIGHT) / 2,
      }
    }

    function elasticPosition(value, min, max) {
      if (value < min) {
        return min + (value - min) * DRAG_ELASTIC
      }
      if (value > max) {
        return max + (value - max) * DRAG_ELASTIC
      }
      return value
    }

    function updateTransform() {
      host.style.transform =
        'translate(-50%, -50%) translate(' +
        x.toFixed(2) +
        'px, ' +
        y.toFixed(2) +
        'px)'
      const theta = 0.64 + x * THETA_PER_PX
      const phi = clamp(-0.42 - y * PHI_PER_PX, PHI_MIN, PHI_MAX)
      const context = createPyramidContext(theta, phi)
      const centerX = (context.hullCenter.x / WIDTH) * 100
      const centerY = (context.hullCenter.y / HEIGHT) * 100
      const topX = (context.bloomAnchors.top.x / WIDTH) * 100
      const topY = (context.bloomAnchors.top.y / HEIGHT) * 100
      const leftX = (context.bloomAnchors.lowerLeft.x / WIDTH) * 100
      const leftY = (context.bloomAnchors.lowerLeft.y / HEIGHT) * 100
      const rightX = (context.bloomAnchors.lowerRight.x / WIDTH) * 100
      const rightY = (context.bloomAnchors.lowerRight.y / HEIGHT) * 100
      const bloomScaleX = Math.max((context.hullBounds.width / WIDTH) * 100, 68)
      const bloomScaleY = Math.max((context.hullBounds.height / HEIGHT) * 100, 78)

      shader.setBloomStyle({
        clipPath: context.clipPath,
        opacity: '1',
        transform: 'scale(1.03)',
        transformOrigin: centerX + '% ' + centerY + '%',
        filter: 'blur(30px) saturate(1.3) brightness(1.22)',
        background:
          'radial-gradient(' +
          bloomScaleX * 0.2 +
          '% ' +
          bloomScaleY * 0.24 +
          '% at ' +
          topX +
          '% ' +
          topY +
          '%, rgba(255, 255, 255, 0.98), rgba(186, 244, 255, 0.68) 34%, rgba(108, 224, 255, 0.2) 62%, rgba(108, 224, 255, 0) 100%), ' +
          'radial-gradient(' +
          bloomScaleX * 0.18 +
          '% ' +
          bloomScaleY * 0.2 +
          '% at ' +
          leftX +
          '% ' +
          leftY +
          '%, rgba(214, 247, 255, 0.58), rgba(110, 221, 255, 0.24) 48%, rgba(110, 221, 255, 0) 100%), ' +
          'radial-gradient(' +
          bloomScaleX * 0.16 +
          '% ' +
          bloomScaleY * 0.18 +
          '% at ' +
          rightX +
          '% ' +
          rightY +
          '%, rgba(208, 244, 255, 0.34), rgba(110, 221, 255, 0.14) 50%, rgba(110, 221, 255, 0) 100%), ' +
          'radial-gradient(' +
          bloomScaleX * 0.44 +
          '% ' +
          bloomScaleY * 0.32 +
          '% at ' +
          centerX +
          '% ' +
          Math.max(centerY - 8, 12) +
          '%, rgba(160, 236, 255, 0.22), rgba(160, 236, 255, 0.08) 54%, rgba(160, 236, 255, 0) 100%)',
      })
      shader.setRimStyle({
        clipPath: context.clipPath,
        opacity: '0.45',
        background:
          'linear-gradient(145deg, rgba(255, 255, 255, 0.72), rgba(205, 246, 255, 0.18) 42%, rgba(255, 255, 255, 0.04) 78%, rgba(255, 255, 255, 0.24))',
        filter:
          'drop-shadow(0 0 6px rgba(170, 240, 255, 0.45)) drop-shadow(0 0 14px rgba(122, 225, 255, 0.18))',
      })
      shader.setFaceOverlay(context.projectedFaces)
      shader.setStyle({
        clipPath: context.clipPath,
        background:
          'linear-gradient(140deg, rgba(255, 255, 255, 0.12), rgba(255, 255, 255, 0.03) 38%, rgba(255, 255, 255, 0.1) 68%, rgba(255, 255, 255, 0.18)), linear-gradient(180deg, rgba(255, 255, 255, 0.14), rgba(255, 255, 255, 0.05))',
      })
      shader.setFragment(function (uv) {
        const trace = tracePyramidRay(uv, context)
        if (!trace) {
          return texture(uv.x, uv.y)
        }
        const bulgedTrace = applyEdgeBulge(trace, uv, context)
        return texture(bulgedTrace.displacedUv.x, bulgedTrace.displacedUv.y)
      })
    }

    function tick() {
      animationFrame = 0
      if (!dragging) {
        const b = bounds()
        x += vx
        y += vy
        vx *= VELOCITY_DAMPING
        vy *= VELOCITY_DAMPING

        if (x < b.minX) {
          vx += (b.minX - x) * BOUND_SPRING
          vx *= BOUND_DAMPING
        } else if (x > b.maxX) {
          vx += (b.maxX - x) * BOUND_SPRING
          vx *= BOUND_DAMPING
        }

        if (y < b.minY) {
          vy += (b.minY - y) * BOUND_SPRING
          vy *= BOUND_DAMPING
        } else if (y > b.maxY) {
          vy += (b.maxY - y) * BOUND_SPRING
          vy *= BOUND_DAMPING
        }

        if (Math.abs(vx) < 0.01 && Math.abs(vy) < 0.01) {
          if (x < b.minX) x = b.minX
          if (x > b.maxX) x = b.maxX
          if (y < b.minY) y = b.minY
          if (y > b.maxY) y = b.maxY
        } else {
          animationFrame = requestAnimationFrame(tick)
        }
      }

      updateTransform()
    }

    function scheduleTick() {
      if (!animationFrame) {
        animationFrame = requestAnimationFrame(tick)
      }
    }

    function onPointerDown(event) {
      dragging = true
      pointerId = event.pointerId
      host.setPointerCapture(pointerId)
      host.style.cursor = 'grabbing'
      dragStartX = event.clientX
      dragStartY = event.clientY
      dragOriginX = x
      dragOriginY = y
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      lastPointerTime = performance.now()
      vx = 0
      vy = 0
    }

    function onPointerMove(event) {
      if (!dragging || event.pointerId !== pointerId) {
        return
      }

      const b = bounds()
      x = elasticPosition(
        dragOriginX + (event.clientX - dragStartX),
        b.minX,
        b.maxX,
      )
      y = elasticPosition(
        dragOriginY + (event.clientY - dragStartY),
        b.minY,
        b.maxY,
      )

      const now = performance.now()
      const dt = Math.max(1, now - lastPointerTime)
      vx = ((event.clientX - lastPointerX) / dt) * 16
      vy = ((event.clientY - lastPointerY) / dt) * 16
      lastPointerX = event.clientX
      lastPointerY = event.clientY
      lastPointerTime = now

      updateTransform()
    }

    function endPointer(event) {
      if (!dragging || event.pointerId !== pointerId) {
        return
      }
      dragging = false
      pointerId = null
      host.style.cursor = 'grab'
      scheduleTick()
    }

    host.addEventListener('pointerdown', onPointerDown)
    host.addEventListener('pointermove', onPointerMove)
    host.addEventListener('pointerup', endPointer)
    host.addEventListener('pointercancel', endPointer)
    window.addEventListener('resize', updateTransform)

    updateTransform()

    return {
      element: mount,
      destroy: function () {
        if (animationFrame) {
          cancelAnimationFrame(animationFrame)
        }
        host.removeEventListener('pointerdown', onPointerDown)
        host.removeEventListener('pointermove', onPointerMove)
        host.removeEventListener('pointerup', endPointer)
        host.removeEventListener('pointercancel', endPointer)
        window.removeEventListener('resize', updateTransform)
        shader.destroy()
        mount.remove()
      },
      setDebug: function (enabled) {
        shader.element.querySelector('canvas').style.display = enabled
          ? 'inline-block'
          : 'none'
        shader.debugLabel.style.display = enabled ? 'block' : 'none'
      },
    }
  }

  window.attachLiquidPyramid = attachLiquidPyramid

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function once() {
      document.removeEventListener('DOMContentLoaded', once)
      attachLiquidPyramid()
    })
  } else {
    attachLiquidPyramid()
  }
})()
