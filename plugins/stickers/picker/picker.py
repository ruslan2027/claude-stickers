"""The sticker picker window on Linux (and anywhere Python has Tk 8.6).

Reads the stickers as JSON on stdin, [{ "name", "description", "file" }], and
writes the chosen sticker's name to stdout (nothing when closed). Click a
sticker or press its number; Esc or the close button closes it.
"""

import json
import sys
import tkinter as tk

BACK = "#24252e"
HOVER = "#3a3c4a"
FORE = "#dcdee6"
PICTURE = 88  # pixels


def main():
    items = json.loads(sys.stdin.read() or "[]")
    if not items:
        return
    choice = {"name": ""}

    root = tk.Tk()
    root.title("Stickers")
    root.configure(bg=BACK)
    root.attributes("-topmost", True)
    root.resizable(False, False)

    def pick(name):
        choice["name"] = name
        root.destroy()

    columns = min(5, len(items))
    images = []  # Tk drops a PhotoImage nobody holds
    for i, item in enumerate(items):
        tile = tk.Frame(root, bg=BACK, cursor="hand2", padx=6, pady=4)
        tile.grid(row=i // columns, column=i % columns, padx=2, pady=2)
        picture = None
        try:
            image = tk.PhotoImage(file=item["file"])
            factor = max(1, -(-max(image.width(), image.height()) // PICTURE))
            picture = image.subsample(factor, factor) if factor > 1 else image
            images.append(picture)
        except tk.TclError:
            pass
        label_text = f"{i + 1}  {item['name']}" if i < 9 else item["name"]
        art = tk.Label(tile, image=picture, bg=BACK, width=PICTURE, height=PICTURE) if picture else \
            tk.Label(tile, text=item["description"], wraplength=PICTURE, bg=BACK, fg=FORE)
        art.pack()
        caption = tk.Label(tile, text=label_text, bg=BACK, fg=FORE)
        caption.pack()
        for widget in (tile, art, caption):
            widget.bind("<Button-1>", lambda _e, n=item["name"]: pick(n))
            widget.bind("<Enter>", lambda _e, t=tile: [w.configure(bg=HOVER) for w in (t, *t.winfo_children())])
            widget.bind("<Leave>", lambda _e, t=tile: [w.configure(bg=BACK) for w in (t, *t.winfo_children())])

    def on_key(event):
        if event.keysym == "Escape":
            root.destroy()
        elif event.char.isdigit() and 1 <= int(event.char) <= min(9, len(items)):
            pick(items[int(event.char) - 1]["name"])

    root.bind("<Key>", on_key)

    # Open by the mouse, kept on the screen.
    root.update_idletasks()
    w, h = root.winfo_reqwidth(), root.winfo_reqheight()
    x = min(max(0, root.winfo_pointerx() - w // 2), root.winfo_screenwidth() - w)
    y = min(max(0, root.winfo_pointery() - h - 12), root.winfo_screenheight() - h)
    root.geometry(f"+{x}+{y}")

    # No closing on losing focus: the terminal that started it can take the
    # focus back right after it opens, which would shut it before anyone saw it.
    root.after(50, root.focus_force)
    root.mainloop()
    sys.stdout.write(choice["name"])


if __name__ == "__main__":
    main()
