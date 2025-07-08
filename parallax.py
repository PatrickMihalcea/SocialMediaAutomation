import cv2
import torch
import urllib.request
import os
import numpy as np
from torchvision.transforms import Compose, Resize, ToTensor, Normalize
from PIL import Image
import sys
from depthflow.scene import DepthScene

# from simple_lama_inpainting import SimpleLama


# Load the MiDaS model for depth estimation
model_type = "DPT_Large"  # Options: "DPT_Large", "DPT_Hybrid", "MiDaS_small"
midas = torch.hub.load("intel-isl/MiDaS", model_type)
midas.eval()

# Load the transformation pipeline
# Define a manual transformation pipeline
transform = Compose([
    Resize((384, 384)),  # Resize to match the model's expected input size
    ToTensor(),  # Convert the image to a tensor
    Normalize(mean=[0.485, 0.456, 0.406], std=[0.229, 0.224, 0.225])  # Normalize the image
])

def estimate_depth(image):
    # Ensure the image is a PIL Image
    if isinstance(image, np.ndarray):
        image = Image.fromarray(image)

    # Manually apply transformations
    input_img = transform(image).unsqueeze(0)  # Add batch dimension

    # Ensure the image is on the same device as the model
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    midas.to(device)
    input_img = input_img.to(device)

    # Run depth estimation
    with torch.no_grad():
        depth = midas(input_img)

    # Convert depth map to a numpy array
    depth_map = depth.squeeze().cpu().numpy()

    # Normalize depth map for visualization
    depth_map = cv2.normalize(depth_map, None, 0, 255, cv2.NORM_MINMAX)
    depth_map = depth_map.astype(np.uint8)

    return depth_map


def apply_parallax(image, depth_map, num_frames=10, displacement=40, num_layers=255, exp_base=1.5):
    h, w = image.shape[:2]
    output_frames = []

    # Resize the depth map to match the image dimensions
    depth_map = cv2.resize(depth_map, (w, h))

    # Normalize the depth map to range [0, 1]
    depth_map = depth_map.astype(np.float32) / 255.0

    # Create depth layers
    layer_intervals = np.linspace(0, 1, num_layers + 1)

    # Calculate shifts for each frame
    shifts = np.linspace(-displacement, displacement, num_frames)

    model=ModelManager('lama')

    for shift in shifts:
        # Initialize the combined image for this frame
        combined_image = np.zeros_like(image)
        combined_mask = np.ones((h, w), dtype=np.uint8) * 255  # Mask to track empty areas

        for i in range(num_layers):
            # Create masks for the current layer based on depth intervals
            layer_mask = (depth_map >= layer_intervals[i]) & (depth_map < layer_intervals[i + 1])
            layer_mask = layer_mask.astype(np.uint8) * 255  # Convert to 8-bit mask

            # Extract the layer from the previous frame
            layer = cv2.bitwise_and(image, image, mask=layer_mask)

            # Calculate exponential displacement
            layer_displacement = int(shift * (i / num_layers) ** exp_base)

            # Apply affine transformation for displacement
            M = np.float32([[1, 0, layer_displacement], [0, 1, 0]])
            shifted_layer = cv2.warpAffine(layer, M, (w, h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT)

            # Update the combined mask to track gaps
            shifted_layer_gray = cv2.cvtColor(shifted_layer, cv2.COLOR_BGR2GRAY)
            combined_mask[(shifted_layer_gray > 0)] = 0  # Turn pixels black if they are part of the image

            # Combine the shifted layer with the existing combined image
            combined_image = cv2.add(combined_image, shifted_layer)

        # Convert combined_mask to a binary image for inpainting
        combined_mask = cv2.dilate(combined_mask, np.ones((5, 5), np.uint8), iterations=1)


        # Inpaint using the combined mask
        # inpainted_image = cv2.inpaint(combined_image, combined_mask, inpaintRadius=1, flags=cv2.INPAINT_TELEA)

        inpainted_image = model.predict(combined_image, combined_mask, Config(pad_mode="constant"))

        output_frames.append(inpainted_image)
        sys.stdout.write(f'\r{round((shift+displacement)/(displacement*2)*100)}%')

    return output_frames



def create_video(frames, output_path, fps=30):
    h, w = frames[0].shape[:2]
    fourcc = cv2.VideoWriter_fourcc(*'mp4v')
    video = cv2.VideoWriter(output_path, fourcc, fps, (w, h))

    for frame in frames:
        if frame.dtype != np.uint8:
            frame = cv2.convertScaleAbs(frame) 
        video.write(frame) 

    video.release()

def main():
    depthscene = DepthScene()
    depthscene.input(image="/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/TreehouseInpaintUpscale.png")
    depthscene.main(output="/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/video.mp4")
    # image_path = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/Designer (7).png"
    # img = cv2.imread(image_path)
    # output_video_path = "/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/video.mp4"

    # # Estimate depth using MiDaS
    # # depth_map = estimate_depth(img)
    # depth_map = cv2.imread("/Users/Patrick1/Documents/Projects/SocialMediaAutomation/images/TestImages/TreehouseDepthMap.png", cv2.IMREAD_GRAYSCALE)

    # # Apply the parallax effect
    # parallax_frames = apply_parallax(img, depth_map)

    # # Create the video from frames
    # create_video(parallax_frames, output_video_path)

    # print(f"3D parallax video saved to {output_video_path}")

if __name__ == "__main__":
    main()