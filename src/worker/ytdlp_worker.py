import sys, json, argparse, yt_dlp
from uuid import uuid4

def make_parser():
    
    shord_uid = uuid4().hex[:8]
    default_outtmpl = f"%(title)s_{shord_uid}.%(ext)s"
    
    p = argparse.ArgumentParser(description="yt-dlp worker process")
    p.add_argument("url", help="video url")
    p.add_argument("--outtmpl", default=default_outtmpl)
    p.add_argument("--format", default="bestvideo+bestaudio/best")
    p.add_argument("--ffmpeg-location", dest="ffmpeg_location", default=None)
    p.add_argument("--cookies", dest="cookies", default=None)
    p.add_argument("--playlist", action="store_true", help="allow playlist")
    
    return p


def progress_hook(d):
    try:
        if d.get("status") == "downloading":
            payload = {
                "status": "downloading",
                "downloaded_bytes": d.get("downloaded_bytes"),
                "total_bytes": d.get("total_bytes") or d.get("total_bytes_estimate"),
                "speed": d.get("speed"),
                "eta": d.get("eta"),
                "elapsed": d.get("elapsed"),
                "fragment_index": d.get("fragment_index"),
                "framgent_count": d.get("fragment_count"),
                "filename": d.get("filename"),
                "tmpfilename": d.get("tmpfilename"),
            }
            print("PROGRESS " + json.dumps(payload, ensure_ascii=False), flush=True)
        elif d.get("status") == "finished":
            payload = {
                "status": "finished",
                "filename": d.get("filename"),
                "elapsed": d.get("elapsed"),
            }
            print("PROGRESS " + json.dumps(payload, ensure_ascii=False), flush=True)
    except Exception as e:
        print("WORKER ERR "+ json.dumps({"error": str(e)}), flush=True)


def main():
    parser = make_parser()
    args = parser.parse_args()
    
    ydl_opts = {
        "format": args.format,
        "outtmpl": args.outtmpl,
        "quiet": False,
        "no_warnings": False,
        "noplaylist": not args.playlist,
        "progress_hooks": [progress_hook],
    }
    if args.ffmpeg_location:
        ydl_opts["ffmpeg_location"] = args.ffmpeg_location
    if args.cookies:
        ydl_opts["cookiefile"] = args.cookies
    
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            retcode = ydl.download([args.url])
        print("DONE " + json.dumps({"retcode": retcode}, ensure_ascii=False), flush=True)
        sys.exit(0 if retcode == 0 else 1)
    except Exception as e:
        sys.stderr.write("ERROR "+ json.dumps({"error": str(e)}) + "\n")
        sys.stderr.flush()
        sys.exit(2)


if __name__ == "__main__":
    main()