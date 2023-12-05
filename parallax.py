import cv2
import torch
import urllib.request

import matplotlib.pyplot as plt

def applyParallax(imagePath):
    model_type = "DPT_Large" 
    midas = torch.hub.load("intel-isl/MiDaS", model_type)
    device = torch.device("cuda") if torch.cuda.is_available() else torch.device("cpu")
    midas.to(device)
    midas.eval()
    midas_transforms = torch.hub.load("intel-isl/MiDaS", "transforms")

    if model_type == "DPT_Large" or model_type == "DPT_Hybrid":
        transform = midas_transforms.dpt_transform
    else:
        transform = midas_transforms.small_transform

    img = cv2.imread(imagePath)
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)

    input_batch = transform(img).to(device)
    with torch.no_grad():
        prediction = midas(input_batch)

        prediction = torch.nn.functional.interpolate(
            prediction.unsqueeze(1),
            size=img.shape[:2],
            mode="bicubic",
            align_corners=False,
        ).squeeze()

    output = prediction.cpu().numpy()
    # Get the original image dimensions
    image_height, image_width = img.shape[:2]

    # Set the figure size to match the original image dimensions
    plt.figure(figsize=(image_width / 100, image_height / 100))

    plt.imshow(output, cmap='gray_r')
    plt.axis('off')
    plt.savefig("depth_map.jpg", dpi=100, bbox_inches='tight', pad_inches=0)
    return
