
// Enhanced Market Pricing Logic - Fixed for Special Variants and BNIB
// Addresses incorrect market valuation for pieces like 228238 Casino Green

const ENHANCED_PRICING = {
    specialVariants: {
        "228238": {
            baseRetail: 41550,
            variants: {
                "casino_green": { marketMultiplier: 1.45, bnibPremium: 0.25 },
                "black_diamond_baguette": { marketMultiplier: 1.30, bnibPremium: 0.22 },
                "black_diamond": { marketMultiplier: 1.25, bnibPremium: 0.22 },
                "champagne": { marketMultiplier: 1.15, bnibPremium: 0.18 },
                "default": { marketMultiplier: 1.20, bnibPremium: 0.18 }
            }
        },
        "126519LN": {
            baseRetail: 39650,
            variants: {
                "ghost": { marketMultiplier: 1.38, bnibPremium: 0.25 },
                "grey_black": { marketMultiplier: 1.30, bnibPremium: 0.20 },
                "default": { marketMultiplier: 1.25, bnibPremium: 0.18 }
            }
        },
        "126519": {
            baseRetail: 39650,
            variants: {
                "ghost": { marketMultiplier: 1.38, bnibPremium: 0.25 },
                "default": { marketMultiplier: 1.25, bnibPremium: 0.18 }
            }
        }
    },
    
    detectVariant(description) {
        const desc = description.toLowerCase();
        
        if (desc.includes('casino') || desc.includes('money') || (desc.includes('green') && desc.includes('228238'))) {
            return "casino_green";
        } else if (desc.includes('black diamond') && desc.includes('baguette')) {
            return "black_diamond_baguette";
        } else if (desc.includes('black diamond')) {
            return "black_diamond";
        } else if (desc.includes('ghost')) {
            return "ghost";
        } else if (desc.includes('grey black') || desc.includes('gray black')) {
            return "grey_black";
        } else if (desc.includes('champagne')) {
            return "champagne";
        }
        return "default";
    },
    
    detectCondition(description) {
        const desc = description.toLowerCase();
        
        // Strong BNIB indicators
        if (desc.includes('bnib') || desc.includes('brand new') || desc.includes('new in box') ||
            desc.includes('full set') || desc.includes('retail ready') || desc.includes('unworn')) {
            return "bnib";
        }
        
        // Date patterns suggest new pieces (2025/2026)
        if (/\b(0[1-9]|1[0-2])\/(202[56])\b/.test(description) ||
            /(January|February|March|April|May|June|July|August|September|October|November|December)\s+202[56]/.test(description)) {
            return "bnib";
        }
        
        return "excellent";
    },
    
    calculateMarketValue(refNumber, description, costPrice = null) {
        const retailPrices = {
            "228238": 41550,
            "126519LN": 39650,
            "126519": 39650,
            "228235": 48250,
            "126500LN": 16100,
            "126334": 11600,
            "126610LN": 10250
        };
        
        const baseRetail = retailPrices[refNumber];
        if (!baseRetail) return null;
        
        const condition = this.detectCondition(description);
        const variant = this.detectVariant(description);
        
        let marketMultiplier = 1.20;
        let bnibPremium = 0.18;
        
        // Get special variant pricing if available
        if (this.specialVariants[refNumber]) {
            const variantData = this.specialVariants[refNumber].variants[variant] || 
                              this.specialVariants[refNumber].variants.default;
            marketMultiplier = variantData.marketMultiplier;
            bnibPremium = variantData.bnibPremium;
        }
        
        // Calculate market value
        const baseMarket = baseRetail * marketMultiplier;
        const finalMarket = condition === "bnib" ? baseMarket * (1 + bnibPremium) : baseMarket * 0.92;
        
        const result = {
            marketValue: Math.round(finalMarket),
            baseRetail: baseRetail,
            variant: variant,
            condition: condition,
            marketMultiplier: marketMultiplier,
            bnibPremium: condition === "bnib" ? bnibPremium : 0,
            baseMarket: Math.round(baseMarket)
        };
        
        if (costPrice) {
            result.costVsMarket = ((costPrice / finalMarket) - 1) * 100;
            result.analysis = result.costVsMarket < 5 ? "EXCELLENT" :
                             result.costVsMarket < 12 ? "GOOD" :
                             result.costVsMarket < 20 ? "PREMIUM" : "EXPENSIVE";
        }
        
        return result;
    }
};

// Make it available globally
window.ENHANCED_PRICING = ENHANCED_PRICING;
