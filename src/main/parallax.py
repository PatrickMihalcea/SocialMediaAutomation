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
from videoMaker import VideoMaker

class Parallax:
    def __init__(self):
        self.depthscene = DepthScene()
        self.videoMaker = VideoMaker()

    # Return outputPath to video.
    def applyParallax(self, folder, secondsPerImage):
        clipUrls = []
        renameToJPEG(folder)
        images = [os.path.join(folder, img) for img in os.listdir(folder) if img.endswith(('jpeg'))]
        videoCount = 1
        for img in images:
            self.depthscene.input(img)
            output = os.path.join(folder, 'parallaxVideo_'+str(videoCount)+'.mp4')
            self.depthscene.main(time=str(secondsPerImage), output=output)
            videoCount += 1
            clipUrls.append(output)

        output_path = self.videoMaker.mergeVideosFromUrlList(clipUrls, folder)
        return output_path
    

def main():
    # Specific image testing.
    # depthscene = DepthScene()
    # depthscene.input(image="/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/2025-07-14_13-01-57/generated_image_5.jpeg")
    # depthscene.main(time="3", output="/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/video_2.mp4")

    # Folder testing
    directory = 'images/2025-07-14_21-29-24'
    parallax = Parallax()
    outputVideo = parallax.applyParallax(directory, 0.5)  


if __name__ == "__main__":
    main()