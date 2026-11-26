/** Câu hỏi thường gặp — dùng chung trang chủ và trang sản phẩm. */
export const FAQ_ITEMS = [
  {
    q: 'Vòng có phải làm từ cây dâu tằm thật hay không?',
    a: 'Em cam kết vòng dâu tằm em làm đều làm thủ công từ cây dâu tằm ta Việt Nam do chính nhà em trồng, dâu tằm nhà em rất nhiều vào mùa đông nhà em còn lấy dâu tằm làm củi để đốt luộc bánh trưng với sưởi ấm luôn ạ.',
  },
  {
    q: 'Bạc mix vòng là loại bạc gì S925, S990 hay S999?',
    a: 'Bạc em dùng chủ yếu là bạc S999 ạ (chỉ có charm hoa sen, charm thánh giá là bạc s925 và charm chuông là bạc S990). Các mẹ có thể mang ra tiệm bạc để kiểm tra thoải mái ạ.',
  },
  {
    q: 'Có cam kết bạc thật không?',
    a: 'Em cam kết bạc thật ạ. Em làm vòng dâu tằm cho các bé đến 9/2026 là đã hơn 2 năm, bên em mua đi bán lại với rất nhiều tiệm bạc. Trong quá trình bán vòng cũng rất nhiều mẹ nghi ngờ, có mẹ còn chửi vì bảo e bán bạc giả. Em có tự tin giải thích và để các mẹ đi kiểm tra thì tất cả các mẹ đi kiểm tra đều được tiệm bạc khẳng định là bạc thật ạ.',
  },
  {
    q: 'Vòng đụng nước thì có làm sao không?',
    a: 'Vòng dâu em làm đều lấy từ phần gốc của cây dâu tằm, nên rất già chắc và đặc lõi, nên ngâm nước thoải mái không bị làm sao. Nhưng ngâm nước lâu và nhiều thì hạt dâu tằm sẽ đậm hơn và sẽ cũ theo thời gian vì không dùng hóa chất bảo quản gì cả.',
  },
  {
    q: 'Vòng mua cho bé sơ sinh thì bé lớn có đeo được tiếp không?',
    a: 'Các mẫu vòng dâu rút đỏ thì đều có thể nới rộng ra khi bé lớn, nên không sợ bị trật. Còn các mẫu vòng co giãn thì sẽ không nới rộng được, nhưng em đã làm trừ hao sẵn để bé vẫn đeo được lâu dài với các vòng co giãn rồi ạ, nên các mẹ cứ yên tâm nha.',
  },
  {
    q: 'Vòng không sử dụng lâu ngày có mốc không?',
    a: 'Dạ, có thể ạ. Vì vòng em làm không dùng hóa chất chống mốc để an toàn cho bé. Nên nếu không sử dụng để ngoài không khí nồm ẩm có thể bị mốc (nhưng rất hiếm khi bị). Còn nếu đeo trên bé hằng ngày, có hơi người thì vòng không bao giờ mốc được ạ.',
  },
  {
    q: 'Bạc này đeo có bị đen hay không?',
    a: 'Tùy cơ địa mỗi người đeo, không khí và nguồn nước, có người sẽ bị đen, có bé bị ngả vàng có người không bị gì cả ạ. Nhưng phần lớn em thấy những người đeo vòng dâu tằm mix bạc bên em đều không bị ngả màu, chỉ có một số rất ít bé đeo là bị thôi ạ. Chỉ cần tẩy lại bằng nước tẩy bạc họ ra tiệm nhờ họ làm sáng lại là được ạ.',
  },
  {
    q: 'Vòng dây co giãn xỏ bằng dây gì? Có dễ bị đứt không?',
    a: 'Vòng dâu tằm tằm dây co giãn em xỏ bằng loại dây cước co giãn loại tốt nhất, rất là bền, không bị bài nhão khi co kéo, nên các mẹ yên tâm nha. Ngoài ra em cũng có gửi thêm dây phòng hờ để nếu các mẹ có thể xỏ lại nếu cần ạ',
  },
] as const;

export type FaqItem = (typeof FAQ_ITEMS)[number];
