import type { ThemeConfig } from "antd";
import { theme as antdTheme } from "antd";

const neutral = {
    light: {
        primary: "#171717",
        primaryHover: "#000000",
        primaryText: "#ffffff",
        menuBg: "#f5f5f5",
        menuText: "#171717",
        selectActiveBg: "#f5f5f5",
        selectSelectedBg: "#f0f0f0",
        selectText: "#171717",
        tableSelectedBg: "rgba(17, 17, 17, 0.05)",
        tableSelectedHoverBg: "rgba(17, 17, 17, 0.08)",
        controlBorder: "#d6d3d1",
        controlBorderHover: "#a8a29e",
        controlBorderFocus: "#78716c",
        controlFocusRing: "rgba(120, 113, 108, 0.16)",
    },
    dark: {
        primary: "#fafafa",
        primaryHover: "#ffffff",
        primaryText: "#171717",
        menuBg: "#262626",
        menuText: "#fafafa",
        selectActiveBg: "#262626",
        selectSelectedBg: "#333333",
        selectText: "#fafafa",
        tableSelectedBg: "rgba(255, 255, 255, 0.08)",
        tableSelectedHoverBg: "rgba(255, 255, 255, 0.12)",
        controlBorder: "#44403c",
        controlBorderHover: "#78716c",
        controlBorderFocus: "#a8a29e",
        controlFocusRing: "rgba(214, 211, 209, 0.14)",
    },
};

export function getAntThemeConfig(dark: boolean): ThemeConfig {
    const color = dark ? neutral.dark : neutral.light;

    return {
        algorithm: dark ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        cssVar: { key: dark ? "infinite-canvas-dark" : "infinite-canvas-light" },
        token: {
            colorPrimary: color.primary,
            colorInfo: color.primary,
            colorLink: color.primary,
            colorLinkHover: color.primaryHover,
            colorLinkActive: color.primary,
            colorTextLightSolid: color.primaryText,
            borderRadius: 8,
            borderRadiusLG: 12,
            controlHeight: 36,
        },
        components: {
            Button: {
                primaryShadow: "none",
            },
            Input: {
                activeBorderColor: color.controlBorderFocus,
                activeShadow: `0 0 0 3px ${color.controlFocusRing}`,
                hoverBorderColor: color.controlBorderHover,
            },
            InputNumber: {
                activeBorderColor: color.controlBorderFocus,
                activeShadow: `0 0 0 3px ${color.controlFocusRing}`,
                hoverBorderColor: color.controlBorderHover,
            },
            Menu: {
                itemActiveBg: color.menuBg,
                itemHoverBg: color.menuBg,
                itemSelectedBg: color.menuBg,
                itemSelectedColor: color.menuText,
                darkItemHoverBg: neutral.dark.menuBg,
                darkItemSelectedBg: neutral.dark.menuBg,
                darkItemSelectedColor: neutral.dark.menuText,
            },
            Select: {
                activeBorderColor: color.controlBorderFocus,
                activeOutlineColor: color.controlFocusRing,
                hoverBorderColor: color.controlBorderHover,
                optionActiveBg: color.selectActiveBg,
                optionSelectedBg: color.selectSelectedBg,
                optionSelectedColor: color.selectText,
            },
            Table: {
                rowSelectedBg: color.tableSelectedBg,
                rowSelectedHoverBg: color.tableSelectedHoverBg,
            },
        },
    };
}
