include $(TOPDIR)/rules.mk

PKG_NAME:=luci-app-openclash
PKG_VERSION:=0.47.075

PKG_SOURCE_PROTO:=git
PKG_SOURCE_URL:=https://github.com/vernesong/OpenClash.git
PKG_SOURCE_VERSION:=v$(PKG_VERSION)

include $(INCLUDE_DIR)/package.mk

define Package/$(PKG_NAME)
  SECTION:=luci
  CATEGORY:=LuCI
  SUBMENU:=3. Applications
  TITLE:=LuCI support for OpenClash
  DEPENDS:=+curl +ca-bundle +ip-full +ruby +ruby-yaml +kmod-tun +unzip
  PKGARCH:=all
endef

-include $(PKG_BUILD_DIR)/luci-app-openclash/Makefile

$(eval $(call BuildPackage,$(PKG_NAME)))
