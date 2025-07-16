import cv2
import torch
import urllib.request
import os
import numpy as np
from moviepy import VideoFileClip, concatenate_videoclips
from torchvision.transforms import Compose, Resize, ToTensor, Normalize
from PIL import Image
from helper import renameToJPEG
import sys
from depthflow.scene import DepthScene

class Parallax:
    def __init__(self, folder, secondsPerImage):
        self.depthscene = DepthScene()
        self.image_folder = folder
        self.videoCount = 1
        self.secondsPerImage = secondsPerImage
        self.clips = []
        self.clipURLs = []

        # Run the show.
        renameToJPEG(self.image_folder)
        self.images = [os.path.join(self.image_folder, img) for img in os.listdir(self.image_folder) if img.endswith(('jpeg'))]
        self.applyParallax()
        self.mergeClips(self.clips, self.image_folder)
        
    def applyParallax(self):
        for img in self.images:
            self.depthscene.input(img)
            output = os.path.join(self.image_folder, 'parallaxVideo_'+str(self.videoCount)+'.mp4')
            self.depthscene.main(time=str(self.secondsPerImage), output=output)
            self.videoCount += 1
            self.clips.append(VideoFileClip(output))
            self.clipURLs.append(output)
        return
    
    def mergeClips(self, videoClipList, outputLocation):
        if not videoClipList:
            raise ValueError("No valid MP4 clips to merge.")
        final_clip = concatenate_videoclips(videoClipList, method="chain")

        # Create export folder if it doesn't exist
        os.makedirs(outputLocation, exist_ok=True)

        # Find an available filename
        base_name = "mergedParallaxVideo"
        ext = ".mp4"
        counter = 1
        while counter<=25:
            output_filename = f"{base_name}{counter}{ext}"
            output_path = os.path.join(outputLocation, output_filename)
            if not os.path.exists(output_path):
                break
            counter += 1
    
        # Write the video file
        final_clip.write_videofile(output_path, codec="libx264", audio_codec="aac")

        print(f"Merged video saved to: {output_path}")

        # Close and delete all clips to free memory
        for clip in videoClipList:
            clip.close()
        for clip in self.clipURLs:
            os.remove(clip)

        final_clip.close()

def main():
    # Specific image testing.
    # depthscene = DepthScene()
    # depthscene.input(image="/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/2025-07-14_13-01-57/generated_image_5.jpeg")
    # depthscene.main(time="3", output="/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/video_2.mp4")

    # Folder testing
    directory = 'images/2025-07-14_21-29-24'
    parallax = Parallax(directory, 0.5)


if __name__ == "__main__":
    main()