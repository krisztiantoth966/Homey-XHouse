from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
BLUE = (20, 115, 230)
DARK = (10, 28, 52)
LIGHT = (238, 246, 255)
WHITE = (255, 255, 255)
MUTED = (139, 190, 247)

try:
    FONT_BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
    FONT_REG = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
except Exception:
    FONT_BOLD = FONT_REG = None

def font(path, size):
    try:
        return ImageFont.truetype(path, size)
    except Exception:
        return ImageFont.load_default()

def draw_gate(draw, box, garage=False):
    x0, y0, x1, y1 = box
    w, h = x1-x0, y1-y0
    lw = max(3, int(w * .018))
    if garage:
        draw.rounded_rectangle((x0, y0, x1, y1), radius=lw*2, outline=WHITE, width=lw)
        for i in range(1, 6):
            y = y0 + h * i / 6
            draw.line((x0+lw, y, x1-lw, y), fill=MUTED, width=max(2, lw//2))
        draw.line((x0+w*.13, y1, x0+w*.13, y0+h*.82), fill=WHITE, width=lw)
        draw.line((x1-w*.13, y1, x1-w*.13, y0+h*.82), fill=WHITE, width=lw)
    else:
        draw.line((x0, y1, x0, y0), fill=WHITE, width=lw)
        draw.line((x1, y1, x1, y0), fill=WHITE, width=lw)
        draw.line((x0, y0, x1, y0), fill=WHITE, width=lw)
        mid = (x0+x1)/2
        gap = w*.035
        left=(x0+w*.07, y0+h*.16, mid-gap, y1-h*.05)
        right=(mid+gap, y0+h*.16, x1-w*.07, y1-h*.05)
        draw.rectangle(left, outline=WHITE, width=lw)
        draw.rectangle(right, outline=WHITE, width=lw)
        draw.line(((left[0]+left[2])/2,left[1],(left[0]+left[2])/2,left[3]), fill=MUTED, width=max(2,lw//2))
        draw.line(((right[0]+right[2])/2,right[1],(right[0]+right[2])/2,right[3]), fill=MUTED, width=max(2,lw//2))
        draw.ellipse((mid-w*.012, y0+h*.52-w*.012, mid+w*.012, y0+h*.52+w*.012), fill=WHITE)

def make(path, size, title, subtitle, garage=False):
    img=Image.new("RGB", size, DARK)
    d=ImageDraw.Draw(img)
    w,h=size
    # subtle blue panels
    d.rounded_rectangle((int(w*.04), int(h*.06), int(w*.96), int(h*.94)), radius=int(min(w,h)*.06), fill=(12,43,82))
    d.ellipse((int(w*.62), int(-h*.30), int(w*1.16), int(h*.55)), fill=BLUE)
    draw_gate(d,(int(w*.09),int(h*.22),int(w*.48),int(h*.79)),garage=garage)
    f1=font(FONT_BOLD,max(13,int(h*.12)))
    f2=font(FONT_REG,max(8,int(h*.052)))
    d.text((int(w*.55),int(h*.34)), title, font=f1, fill=WHITE)
    d.text((int(w*.55),int(h*.52)), subtitle, font=f2, fill=LIGHT)
    d.rounded_rectangle((int(w*.55),int(h*.66),int(w*.83),int(h*.76)), radius=int(h*.025), fill=BLUE)
    d.text((int(w*.585),int(h*.675)), "HOMEY", font=font(FONT_BOLD,max(7,int(h*.043))), fill=WHITE)
    path.parent.mkdir(parents=True,exist_ok=True)
    img.save(path, optimize=True)

sizes={"small":(250,175),"large":(500,350),"xlarge":(1000,700)}
for name,size in sizes.items():
    make(ROOT/"assets/images"/f"{name}.png",size,"XHouse","Gate control")
    make(ROOT/"drivers/gate/assets/images"/f"{name}.png",size,"XHouse","EGA / EGB Gate")
    make(ROOT/"drivers/garage/assets/images"/f"{name}.png",size,"XHouse","Garage Opener",garage=True)
