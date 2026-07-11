import Svg, { Path, Circle, Line, Polyline, Polygon, Rect } from "react-native-svg";
import { colors } from "../theme";

// Hand-drawn SVG icon set. No emoji, no unicode-glyph stand-ins anywhere.
// 24x24 viewBox, stroke-based unless `filled`.
export default function Icon({ name, size = 22, color = colors.textDim, filled = false, strokeWidth = 2 }) {
  const stroke = { stroke: color, strokeWidth, strokeLinecap: "round", strokeLinejoin: "round", fill: "none" };
  const solid = { fill: color };

  return (
    <Svg width={size} height={size} viewBox="0 0 24 24">
      {paths(name, { stroke, solid, color, filled })}
    </Svg>
  );
}

function paths(name, { stroke, solid, color, filled }) {
  switch (name) {
    case "feed": // stacked layers
      return (
        <>
          <Polygon points="12 2 2 7 12 12 22 7 12 2" {...stroke} />
          <Polyline points="2 17 12 22 22 17" {...stroke} />
          <Polyline points="2 12 12 17 22 12" {...stroke} />
        </>
      );
    case "menu":
      return (
        <>
          <Line x1="3" y1="6" x2="21" y2="6" {...stroke} />
          <Line x1="3" y1="12" x2="21" y2="12" {...stroke} />
          <Line x1="3" y1="18" x2="21" y2="18" {...stroke} />
        </>
      );
    case "discover": // compass
      return (
        <>
          <Circle cx="12" cy="12" r="10" {...stroke} />
          <Polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" {...stroke} />
        </>
      );
    case "you": // person
      return (
        <>
          <Path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" {...stroke} />
          <Circle cx="12" cy="7" r="4" {...stroke} />
        </>
      );
    case "plus":
      return (
        <>
          <Line x1="12" y1="5" x2="12" y2="19" {...stroke} />
          <Line x1="5" y1="12" x2="19" y2="12" {...stroke} />
        </>
      );
    case "minus":
      return <Line x1="5" y1="12" x2="19" y2="12" {...stroke} />;
    case "lock":
      return (
        <>
          <Rect x="3" y="11" width="18" height="11" rx="2" {...stroke} />
          <Path d="M7 11V7a5 5 0 0 1 10 0v4" {...stroke} />
        </>
      );
    case "heart":
      return (
        <Path
          d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 1 0-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 0 0 0-7.78z"
          {...(filled ? { ...solid, stroke: color, strokeWidth: 2, strokeLinejoin: "round" } : stroke)}
        />
      );
    case "comment":
      return (
        <Path
          d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8z"
          {...stroke}
        />
      );
    case "share":
      return (
        <>
          <Polyline points="16 6 12 2 8 6" {...stroke} />
          <Line x1="12" y1="2" x2="12" y2="15" {...stroke} />
          <Path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" {...stroke} />
        </>
      );
    case "play":
      return <Polygon points="6 4 20 12 6 20 6 4" {...solid} />;
    case "photo":
      return (
        <>
          <Rect x="3" y="3" width="18" height="18" rx="2" {...stroke} />
          <Circle cx="8.5" cy="8.5" r="1.5" {...stroke} />
          <Polyline points="21 15 16 10 5 21" {...stroke} />
        </>
      );
    case "pin":
      return (
        <>
          <Path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" {...stroke} />
          <Circle cx="12" cy="10" r="3" {...stroke} />
        </>
      );
    case "trophy":
      return (
        <>
          <Path d="M6 4h12v4a6 6 0 0 1-12 0V4z" {...stroke} />
          <Path d="M6 6H4a2 2 0 0 0 0 4h2M18 6h2a2 2 0 0 1 0 4h-2" {...stroke} />
          <Line x1="12" y1="14" x2="12" y2="18" {...stroke} />
          <Path d="M8 21h8M9 21v-1a3 3 0 0 1 6 0v1" {...stroke} />
        </>
      );
    case "search":
      return (
        <>
          <Circle cx="11" cy="11" r="7" {...stroke} />
          <Line x1="21" y1="21" x2="16.65" y2="16.65" {...stroke} />
        </>
      );
    case "calendar":
      return (
        <>
          <Rect x="3" y="4" width="18" height="18" rx="2" {...stroke} />
          <Line x1="16" y1="2" x2="16" y2="6" {...stroke} />
          <Line x1="8" y1="2" x2="8" y2="6" {...stroke} />
          <Line x1="3" y1="10" x2="21" y2="10" {...stroke} />
        </>
      );
    case "ticket":
      return (
        <>
          <Path d="M3 8a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2 2 2 0 0 0 0 4 2 2 0 0 1-2 2H5a2 2 0 0 1-2-2 2 2 0 0 0 0-4z" {...stroke} />
          <Line x1="12" y1="7" x2="12" y2="15" strokeDasharray="1 2" {...stroke} />
        </>
      );
    case "external":
      return (
        <>
          <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" {...stroke} />
          <Polyline points="15 3 21 3 21 9" {...stroke} />
          <Line x1="10" y1="14" x2="21" y2="3" {...stroke} />
        </>
      );
    case "logout":
      return (
        <>
          <Path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" {...stroke} />
          <Polyline points="16 17 21 12 16 7" {...stroke} />
          <Line x1="21" y1="12" x2="9" y2="12" {...stroke} />
        </>
      );
    case "check":
      return <Polyline points="20 6 9 17 4 12" {...stroke} />;
    case "x":
      return (
        <>
          <Line x1="18" y1="6" x2="6" y2="18" {...stroke} />
          <Line x1="6" y1="6" x2="18" y2="18" {...stroke} />
        </>
      );
    case "shield":
      return <Path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" {...stroke} />;
    case "trash":
      return (
        <>
          <Polyline points="3 6 5 6 21 6" {...stroke} />
          <Path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" {...stroke} />
        </>
      );
    case "mail":
      return (
        <>
          <Rect x="2" y="4" width="20" height="16" rx="2" {...stroke} />
          <Path d="M22 6 12 13 2 6" {...stroke} />
        </>
      );
    case "bell":
      return (
        <>
          <Path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" {...stroke} />
          <Path d="M13.7 21a2 2 0 0 1-3.4 0" {...stroke} />
        </>
      );
    case "flag":
      return (
        <>
          <Path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" {...stroke} />
          <Line x1="4" y1="22" x2="4" y2="15" {...stroke} />
        </>
      );
    case "edit":
      return (
        <>
          <Path d="M12 20h9" {...stroke} />
          <Path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" {...stroke} />
        </>
      );
    case "user-plus":
      return (
        <>
          <Path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" {...stroke} />
          <Circle cx="9" cy="7" r="4" {...stroke} />
          <Line x1="19" y1="8" x2="19" y2="14" {...stroke} />
          <Line x1="16" y1="11" x2="22" y2="11" {...stroke} />
        </>
      );
    case "music":
      return (
        <>
          <Path d="M9 18V5l12-2v13" {...stroke} />
          <Circle cx="6" cy="18" r="3" {...stroke} />
          <Circle cx="18" cy="16" r="3" {...stroke} />
        </>
      );
    case "globe":
      return (
        <>
          <Circle cx="12" cy="12" r="10" {...stroke} />
          <Line x1="2" y1="12" x2="22" y2="12" {...stroke} />
          <Path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" {...stroke} />
        </>
      );
    case "clock":
      return (
        <>
          <Circle cx="12" cy="12" r="10" {...stroke} />
          <Polyline points="12 6 12 12 16 14" {...stroke} />
        </>
      );
    case "camera":
      return (
        <>
          <Path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" {...stroke} />
          <Circle cx="12" cy="13" r="4" {...stroke} />
        </>
      );
    case "food":
      return (
        <>
          <Path d="M5 3v6a2 2 0 0 0 4 0V3" {...stroke} />
          <Line x1="7" y1="9" x2="7" y2="21" {...stroke} />
          <Path d="M17 3c-1.5 0-2.5 2-2.5 5s1 4 2.5 4 2.5-1 2.5-4-1-5-2.5-5z" {...stroke} />
          <Line x1="17" y1="12" x2="17" y2="21" {...stroke} />
        </>
      );
    case "drink":
      return (
        <>
          <Path d="M5 4h14l-6 8z" {...stroke} />
          <Line x1="12" y1="12" x2="12" y2="20" {...stroke} />
          <Line x1="8" y1="20" x2="16" y2="20" {...stroke} />
        </>
      );
    case "chevron-left":
      return <Polyline points="15 18 9 12 15 6" {...stroke} />;
    case "chevron-right":
      return <Polyline points="9 18 15 12 9 6" {...stroke} />;
    case "chevron-down":
      return <Polyline points="6 9 12 15 18 9" {...stroke} />;
    case "star":
      return <Polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" {...solid} />;
    case "shuffle":
      return (
        <>
          <Polyline points="16 3 21 3 21 8" {...stroke} />
          <Line x1="4" y1="20" x2="21" y2="3" {...stroke} />
          <Polyline points="21 16 21 21 16 21" {...stroke} />
          <Line x1="15" y1="15" x2="21" y2="21" {...stroke} />
          <Line x1="4" y1="4" x2="9" y2="9" {...stroke} />
        </>
      );
    default:
      return null;
  }
}
